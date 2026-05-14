/**
 * TASKRESPONSE-19: email-sync-gmail — Supabase Edge Function (Deno 2).
 *
 * PRD anchors:
 *   §3.8 Email APIs — googleapis is the locked Gmail SDK.
 *   §4.2 OAuth token storage — refresh token loaded from `oauth_tokens`, decrypted in-memory.
 *   §4.3 Email content handling — bodies encrypted before storage, never logged in plaintext.
 *   §7.3 Email sync — Gmail backfill — up to 1,000 messages with quota pacing.
 *   §7.5 Email sync — incremental — uses `historyId` from `email_sync_state`.
 *   §7.17 Error handling — exponential backoff up to 6 attempts.
 *   §7.18 Rate-limit handling — token-bucket pacer at 250 quota units/sec.
 *
 * Security contract:
 *   - JWT from Authorization header is forwarded to Supabase client; RLS enforces tenant isolation.
 *   - Refresh token is decrypted in-memory using AES-256-GCM + HKDF-SHA256; never logged.
 *   - Email bodies encrypted with encryptForUser before being stored.
 *   - Service-role key is NEVER used; all DB access is scoped to auth.uid().
 *
 * Invocation:
 *   POST /functions/v1/email-sync-gmail
 *   Authorization: Bearer <user-jwt>
 *
 * Response (200):
 *   { mode: "backfill"|"incremental", userId, processed, historyId, durationMs }
 */

// @ts-ignore Deno global — not available in Node type-checking context.
const _Deno = typeof Deno !== 'undefined' ? Deno : undefined;

import { createClient } from 'npm:@supabase/supabase-js@2';
import { google } from 'npm:googleapis@140';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// ---------------------------------------------------------------------------
// Encryption — AES-256-GCM + HKDF-SHA256 (mirrors src/lib/crypto.ts)
// ---------------------------------------------------------------------------

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

function getMasterKey(): Buffer {
  const raw = _Deno?.env.get('TASKRESPONSE_ENC_MASTER_KEY') ?? '';
  if (!raw || raw.length < 32) {
    throw new Error('TASKRESPONSE_ENC_MASTER_KEY must be >= 32 bytes');
  }
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0) return Buffer.from(raw, 'hex');
  try {
    const b = Buffer.from(raw, 'base64');
    if (b.length >= KEY_LEN) return b;
  } catch { /* fallthrough */ }
  return Buffer.from(raw, 'utf8');
}

function deriveUserKey(userId: string): Buffer {
  const master = getMasterKey();
  const okm = hkdfSync('sha256', master, Buffer.from(userId, 'utf8'), Buffer.from('taskresponse-v1'), KEY_LEN);
  return Buffer.from(okm);
}

function encryptForUser(userId: string, plaintext: string): string {
  const key = deriveUserKey(userId);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(Buffer.from(userId, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

function decryptForUser(userId: string, payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('decryptForUser: unknown ciphertext format');
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const key = deriveUserKey(userId);
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  decipher.setAAD(Buffer.from(userId, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Gmail helpers
// ---------------------------------------------------------------------------

const BACKFILL_TARGET = 1000;
const BATCH_SIZE = 100;
const QUOTA_UNITS_PER_SECOND = 250;
const COST_LIST = 5;
const COST_GET = 5;
const COST_HISTORY = 2;
const MAX_RETRIES = 6;

function backoffMs(attempt: number): number {
  return Math.min(32_000, 2 ** (attempt - 1) * 1000);
}

function isRetryable(err: unknown): boolean {
  const e = err as { code?: number | string; response?: { status?: number }; status?: number };
  const status = (typeof e.code === 'number' ? e.code : undefined) ?? e.response?.status ?? e.status;
  if (typeof status === 'number') return status === 429 || (status >= 500 && status < 600);
  if (typeof e.code === 'string') return ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'].includes(e.code);
  return false;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isRetryable(err) || attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, backoffMs(attempt)));
    }
  }
  throw last;
}

class QuotaPacer {
  private tokens = QUOTA_UNITS_PER_SECOND;
  private last = Date.now();
  async consume(units: number): Promise<void> {
    while (true) {
      const now = Date.now();
      const elapsed = (now - this.last) / 1000;
      if (elapsed > 0) {
        this.tokens = Math.min(QUOTA_UNITS_PER_SECOND, this.tokens + elapsed * QUOTA_UNITS_PER_SECOND);
        this.last = now;
      }
      if (this.tokens >= units) { this.tokens -= units; return; }
      const waitMs = Math.max(1, Math.ceil(((units - this.tokens) / QUOTA_UNITS_PER_SECOND) * 1000));
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

function hashSubject(s: string | null | undefined): string | null {
  if (!s) return null;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return `fnv1a:${h.toString(16)}`;
}

function headerValue(payload: Record<string, unknown> | undefined, name: string): string | null {
  const headers = (payload?.headers ?? []) as Array<{ name?: string; value?: string }>;
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function extractBody(message: Record<string, unknown>): string {
  const out: string[] = [];
  const visit = (part?: Record<string, unknown>) => {
    if (!part) return;
    const body = part.body as Record<string, string> | undefined;
    if (body?.data) out.push(Buffer.from(body.data, 'base64url').toString('utf8'));
    const parts = part.parts as Array<Record<string, unknown>> | undefined;
    parts?.forEach(visit);
  };
  visit((message.payload as Record<string, unknown>) ?? undefined);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Supabase storage adapter
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientAny = ReturnType<typeof createClient<any>>;

async function persistMessage(supabase: SupabaseClientAny, userId: string, msg: Record<string, unknown>): Promise<void> {
  const payload = msg.payload as Record<string, unknown> | undefined;
  const labelIds = (msg.labelIds ?? []) as string[];
  const body = extractBody(msg);
  const bodyBuf = Buffer.from(encryptForUser(userId, body), 'utf8');

  const { error } = await supabase.from('email_messages').upsert(
    {
      user_id: userId,
      provider: 'gmail',
      external_message_id: msg.id ?? '',
      thread_id: msg.threadId ?? null,
      sender_email: headerValue(payload, 'From'),
      subject_hash: hashSubject(headerValue(payload, 'Subject')),
      body_encrypted: bodyBuf,
      body_iv: null,
      length_chars: typeof msg.sizeEstimate === 'number' ? msg.sizeEstimate : body.length,
      received_at: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
      is_outbound: labelIds.includes('SENT'),
    },
    { onConflict: 'user_id,provider,external_message_id' },
  );
  if (error) throw new Error(`persistMessage: ${error.message}`);
}

async function updateSyncState(supabase: SupabaseClientAny, userId: string, historyId: string | null): Promise<void> {
  const { error } = await supabase.from('email_sync_state').upsert(
    { user_id: userId, provider: 'gmail', history_id: historyId, last_synced_at: new Date().toISOString() },
    { onConflict: 'user_id,provider' },
  );
  if (error) throw new Error(`updateSyncState: ${error.message}`);
}

async function getSyncState(supabase: SupabaseClientAny, userId: string): Promise<{ historyId: string | null } | null> {
  const { data, error } = await supabase
    .from('email_sync_state')
    .select('history_id')
    .eq('user_id', userId)
    .eq('provider', 'gmail')
    .maybeSingle();
  if (error) throw new Error(`getSyncState: ${error.message}`);
  if (!data) return null;
  return { historyId: (data as { history_id: string | null }).history_id };
}

// ---------------------------------------------------------------------------
// Sync orchestration
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GmailClient = ReturnType<typeof google.gmail>;

async function buildGmailClient(refreshToken: string): Promise<GmailClient> {
  const oauth2 = new google.auth.OAuth2(
    _Deno?.env.get('GOOGLE_OAUTH_CLIENT_ID'),
    _Deno?.env.get('GOOGLE_OAUTH_CLIENT_SECRET'),
  );
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

async function runBackfill(
  gmail: GmailClient,
  supabase: SupabaseClientAny,
  userId: string,
): Promise<{ processed: number; historyId: string | null }> {
  const pacer = new QuotaPacer();
  let processed = 0;
  let pageToken: string | undefined;
  let historyId: string | null = null;

  while (processed < BACKFILL_TARGET) {
    await pacer.consume(COST_LIST);
    const remaining = BACKFILL_TARGET - processed;
    const listResp = await withRetry(() =>
      gmail.users.messages.list({ userId: 'me', maxResults: Math.min(BATCH_SIZE, remaining), pageToken }),
    );
    const ids = (listResp.data.messages ?? []).map((m: { id?: string }) => m.id).filter(Boolean) as string[];
    if (ids.length === 0) break;

    for (const id of ids) {
      await pacer.consume(COST_GET);
      const msgResp = await withRetry(() => gmail.users.messages.get({ userId: 'me', id, format: 'full' }));
      const msg = msgResp.data as Record<string, unknown>;
      await persistMessage(supabase, userId, msg);
      if (msg.historyId && (!historyId || BigInt(msg.historyId as string) > BigInt(historyId))) {
        historyId = msg.historyId as string;
      }
      processed++;
      if (processed >= BACKFILL_TARGET) break;
    }

    pageToken = (listResp.data.nextPageToken as string | undefined) ?? undefined;
    if (!pageToken) break;
  }

  await updateSyncState(supabase, userId, historyId);
  return { processed, historyId };
}

async function runIncremental(
  gmail: GmailClient,
  supabase: SupabaseClientAny,
  userId: string,
  startHistoryId: string,
): Promise<{ processed: number; historyId: string | null }> {
  const pacer = new QuotaPacer();
  let processed = 0;
  let pageToken: string | undefined;
  let newHistoryId = startHistoryId;

  while (true) {
    await pacer.consume(COST_HISTORY);
    const histResp = await withRetry(() =>
      gmail.users.history.list({
        userId: 'me',
        startHistoryId,
        historyTypes: ['messageAdded', 'labelAdded', 'labelRemoved'],
        pageToken,
      }),
    );

    const records = (histResp.data.history ?? []) as Array<Record<string, unknown>>;
    const messageIds = new Set<string>();
    for (const h of records) {
      for (const m of (h.messagesAdded ?? []) as Array<{ message?: { id?: string } }>) {
        if (m.message?.id) messageIds.add(m.message.id);
      }
      for (const m of (h.messages ?? []) as Array<{ id?: string }>) {
        if (m.id) messageIds.add(m.id);
      }
    }

    for (const id of messageIds) {
      await pacer.consume(COST_GET);
      const msgResp = await withRetry(() => gmail.users.messages.get({ userId: 'me', id, format: 'full' }));
      const msg = msgResp.data as Record<string, unknown>;
      await persistMessage(supabase, userId, msg);
      processed++;
      if (msg.historyId && BigInt(msg.historyId as string) > BigInt(newHistoryId)) {
        newHistoryId = msg.historyId as string;
      }
    }

    const respHistoryId = histResp.data.historyId as string | undefined;
    if (respHistoryId && BigInt(respHistoryId) > BigInt(newHistoryId)) {
      newHistoryId = respHistoryId;
    }

    pageToken = (histResp.data.nextPageToken as string | undefined) ?? undefined;
    if (!pageToken) break;
  }

  await updateSyncState(supabase, userId, newHistoryId);
  return { processed, historyId: newHistoryId };
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

// @ts-ignore Deno.serve — not available in Node type-checking context.
_Deno && Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing authorization header' }, 401);
  }
  const token = authHeader.slice(7);

  const supabaseUrl = _Deno?.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = _Deno?.env.get('SUPABASE_ANON_KEY') ?? '';

  // User-scoped Supabase client — RLS enforces tenant isolation (§4.1).
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const userId = user.id;
  const start = Date.now();

  try {
    // Load encrypted refresh token (§4.2).
    const { data: tokenRow, error: tokenError } = await supabase
      .from('oauth_tokens')
      .select('encrypted_refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'gmail')
      .maybeSingle();
    if (tokenError) return jsonResponse({ error: tokenError.message }, 500);
    if (!tokenRow) return jsonResponse({ error: 'Gmail not connected — no oauth token found' }, 400);

    // Decrypt refresh token in-memory (§4.2 — never persisted as plaintext).
    const refreshToken = decryptForUser(
      userId,
      (tokenRow as { encrypted_refresh_token: string }).encrypted_refresh_token,
    );

    // Determine sync mode.
    const state = await getSyncState(supabase, userId);
    const mode = state?.historyId ? 'incremental' : 'backfill';

    // Build the Gmail API client (mints access token at runtime, §4.2).
    const gmail = await buildGmailClient(refreshToken);

    // Run the sync.
    const result = mode === 'backfill'
      ? await runBackfill(gmail, supabase, userId)
      : await runIncremental(gmail, supabase, userId, state!.historyId!);

    return jsonResponse({
      mode,
      userId,
      processed: result.processed,
      historyId: result.historyId,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    // 400 for "not connected" class errors; 500 for everything else.
    const status = message.toLowerCase().includes('not connected') ? 400 : 500;
    return jsonResponse({ error: message }, status);
  }
});
