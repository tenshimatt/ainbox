/**
 * Supabase Edge Function: email-sync-delta
 *
 * AINBOX-30: §7.5 Email sync — incremental delta (cron dispatcher).
 *
 * PRD: §7.5  Email sync — incremental delta — pg_cron + delta-token / historyId pattern.
 *      §4.1  Auth model — CRON_SECRET bearer (service-role system action exception).
 *      §4.2  OAuth token storage — decrypt refresh tokens in-memory only.
 *      §4.3  Email content — encrypt before storage, never logged in plaintext.
 *      §7.3  Gmail incremental — history.list from stored historyId.
 *      §7.4  Outlook incremental — Graph delta URL from stored deltaToken.
 *      §7.17 Error handling — exponential backoff up to 6 attempts.
 *      §7.18 Rate-limit handling — quota pacers for Gmail and Graph.
 *
 * Batch dispatcher (service-role): finds all users whose backfill is complete,
 * then runs incremental sync for each using their stored checkpoint token.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` (system action — uses the
 * approved service-role exception from PRD §4.1; NOT user-facing).
 *
 * Request:  POST /functions/v1/email-sync-delta  Body: { "limit"?: number }
 * Response: { ok, examined, synced, errors, detail }
 *
 * Deno entry point — see ./handler.ts for the pure, testable HTTP handler.
 */

// @ts-ignore Deno global — not available in Node type-checking context.
const _Deno = typeof Deno !== 'undefined' ? Deno : undefined;

import { createClient } from 'npm:@supabase/supabase-js@2';
import { google } from 'npm:googleapis@140';
import { Client, type ClientOptions } from 'npm:@microsoft/microsoft-graph-client@3';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import {
  handleDeltaSyncRequest,
  type DeltaSyncDeps,
  DELTA_BATCH_LIMIT,
} from './handler.ts';

// ── Config ────────────────────────────────────────────────────────────────

const CRON_SECRET = _Deno?.env.get('CRON_SECRET') ?? '';
const SUPABASE_URL = _Deno?.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = _Deno?.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// ---------------------------------------------------------------------------
// Encryption — AES-256-GCM + HKDF-SHA256 (mirrors src/lib/crypto.ts)
// ---------------------------------------------------------------------------

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

function getMasterKey(): Buffer {
  const raw = _Deno?.env.get('AINBOX_ENC_MASTER_KEY') ?? '';
  if (!raw || raw.length < 32) {
    throw new Error('AINBOX_ENC_MASTER_KEY must be >= 32 bytes');
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
  const okm = hkdfSync('sha256', master, Buffer.from(userId, 'utf8'), Buffer.from('ainbox-v1'), KEY_LEN);
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
// Shared retry — exponential backoff up to 6 attempts (§7.17)
// ---------------------------------------------------------------------------

const MAX_RETRIES = 6;

function isRetryable(err: unknown): boolean {
  const e = err as { code?: number | string; response?: { status?: number }; status?: number; statusCode?: number };
  const status =
    (typeof e.code === 'number' ? e.code : undefined) ??
    e.statusCode ??
    e.response?.status ??
    e.status;
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
      const backoffMs = Math.min(32_000, 2 ** (attempt - 1) * 1000);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw last;
}

// ---------------------------------------------------------------------------
// Supabase type alias
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientAny = ReturnType<typeof createClient<any>>;

// ---------------------------------------------------------------------------
// Gmail incremental sync (§7.3 / §7.5)
// ---------------------------------------------------------------------------

const GMAIL_QUOTA_UNITS_PER_SECOND = 250;
const GMAIL_COST_GET = 5;
const GMAIL_COST_HISTORY = 2;

class GmailQuotaPacer {
  private tokens = GMAIL_QUOTA_UNITS_PER_SECOND;
  private last = Date.now();
  async consume(units: number): Promise<void> {
    while (true) {
      const now = Date.now();
      const elapsed = (now - this.last) / 1000;
      if (elapsed > 0) {
        this.tokens = Math.min(GMAIL_QUOTA_UNITS_PER_SECOND, this.tokens + elapsed * GMAIL_QUOTA_UNITS_PER_SECOND);
        this.last = now;
      }
      if (this.tokens >= units) { this.tokens -= units; return; }
      const waitMs = Math.max(1, Math.ceil(((units - this.tokens) / GMAIL_QUOTA_UNITS_PER_SECOND) * 1000));
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

function hashSubjectGmail(s: string | null | undefined): string | null {
  if (!s) return null;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return `fnv1a:${h.toString(16)}`;
}

function headerValue(payload: Record<string, unknown> | undefined, name: string): string | null {
  const headers = (payload?.headers ?? []) as Array<{ name?: string; value?: string }>;
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function extractGmailBody(message: Record<string, unknown>): string {
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

async function persistGmailMessage(
  supabase: SupabaseClientAny,
  userId: string,
  msg: Record<string, unknown>,
): Promise<void> {
  const payload = msg.payload as Record<string, unknown> | undefined;
  const labelIds = (msg.labelIds ?? []) as string[];
  const body = extractGmailBody(msg);
  const bodyBuf = Buffer.from(encryptForUser(userId, body), 'utf8');

  const { error } = await supabase.from('email_messages').upsert(
    {
      user_id: userId,
      provider: 'gmail',
      external_message_id: msg.id ?? '',
      thread_id: msg.threadId ?? null,
      sender_email: headerValue(payload, 'From'),
      subject_hash: hashSubjectGmail(headerValue(payload, 'Subject')),
      body_encrypted: bodyBuf,
      body_iv: null,
      length_chars: typeof msg.sizeEstimate === 'number' ? msg.sizeEstimate : body.length,
      received_at: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
      is_outbound: labelIds.includes('SENT'),
    },
    { onConflict: 'user_id,provider,external_message_id' },
  );
  if (error) throw new Error(`persistGmailMessage: ${error.message}`);
}

async function updateGmailSyncState(
  supabase: SupabaseClientAny,
  userId: string,
  historyId: string,
): Promise<void> {
  const { error } = await supabase.from('email_sync_state').upsert(
    { user_id: userId, provider: 'gmail', history_id: historyId, last_synced_at: new Date().toISOString() },
    { onConflict: 'user_id,provider' },
  );
  if (error) throw new Error(`updateGmailSyncState: ${error.message}`);
}

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

async function gmailIncremental(
  supabase: SupabaseClientAny,
  userId: string,
  startHistoryId: string,
): Promise<{ processed: number; newHistoryId: string | null }> {
  // Load encrypted refresh token (service-role bypasses RLS — approved exception §4.1).
  const { data: tokenRow, error: tokenError } = await supabase
    .from('oauth_tokens')
    .select('encrypted_refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'gmail')
    .maybeSingle();
  if (tokenError) throw new Error(`oauth_tokens fetch: ${tokenError.message}`);
  if (!tokenRow) throw new Error('Gmail not connected — no oauth token found');

  const refreshToken = decryptForUser(
    userId,
    (tokenRow as { encrypted_refresh_token: string }).encrypted_refresh_token,
  );

  const gmail = await buildGmailClient(refreshToken);
  const pacer = new GmailQuotaPacer();
  let processed = 0;
  let pageToken: string | undefined;
  let newHistoryId = startHistoryId;

  while (true) {
    await pacer.consume(GMAIL_COST_HISTORY);
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
      await pacer.consume(GMAIL_COST_GET);
      const msgResp = await withRetry(() =>
        gmail.users.messages.get({ userId: 'me', id, format: 'full' }),
      );
      const msg = msgResp.data as Record<string, unknown>;
      await persistGmailMessage(supabase, userId, msg);
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

  // Persist updated historyId regardless of whether messages were fetched
  // (the API always returns a new historyId reflecting current state).
  if (newHistoryId !== startHistoryId) {
    await updateGmailSyncState(supabase, userId, newHistoryId);
  }

  return { processed, newHistoryId: newHistoryId !== startHistoryId ? newHistoryId : null };
}

// ---------------------------------------------------------------------------
// Outlook incremental sync (§7.4 / §7.5)
// ---------------------------------------------------------------------------

const GRAPH_WINDOW_MS = 10 * 60 * 1000;
const GRAPH_SOFT_LIMIT = Math.floor(10_000 * 0.9);
const MS_TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MS_SCOPES = 'Mail.Read Mail.Send User.Read offline_access';

class GraphPacer {
  private timestamps: number[] = [];

  delayBeforeNext(now = Date.now()): number {
    this.prune(now);
    if (this.timestamps.length < GRAPH_SOFT_LIMIT) return 0;
    const oldest = this.timestamps[0];
    return Math.max(0, oldest + GRAPH_WINDOW_MS - now);
  }

  record(now = Date.now()): void {
    this.prune(now);
    this.timestamps.push(now);
  }

  private prune(now: number): void {
    const cutoff = now - GRAPH_WINDOW_MS;
    while (this.timestamps.length && this.timestamps[0] <= cutoff) {
      this.timestamps.shift();
    }
  }
}

interface GraphMessage {
  id: string;
  subject?: string | null;
  receivedDateTime?: string | null;
  from?: { emailAddress?: { address?: string } } | null;
  body?: { content?: string } | null;
  internetMessageId?: string | null;
  conversationId?: string | null;
}

function subjectHashOutlook(s: string | null | undefined): string {
  const str = s ?? '';
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return `h${(h >>> 0).toString(16)}`;
}

function senderDomain(msg: GraphMessage): string | null {
  const addr = msg.from?.emailAddress?.address;
  if (!addr || typeof addr !== 'string') return null;
  const at = addr.lastIndexOf('@');
  return at < 0 ? null : addr.slice(at + 1).toLowerCase();
}

function buildGraphClient(accessToken: string): Client {
  const opts: ClientOptions = {
    authProvider: {
      getAccessToken: async () => accessToken,
    },
  };
  return Client.initWithMiddleware(opts);
}

async function refreshMicrosoftToken(
  encryptedRefreshToken: string,
  userId: string,
): Promise<{ accessToken: string; newEncryptedRefreshToken?: string }> {
  const clientId = _Deno?.env.get('AZURE_CLIENT_ID') ?? '';
  const clientSecret = _Deno?.env.get('AZURE_CLIENT_SECRET') ?? '';
  if (!clientId || !clientSecret) {
    throw new Error('AZURE_CLIENT_ID and AZURE_CLIENT_SECRET must be set');
  }

  const refreshToken = decryptForUser(userId, encryptedRefreshToken);

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: MS_SCOPES,
  });

  const res = await fetch(MS_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`microsoft_token_refresh_failed: HTTP ${res.status} — ${detail}`);
  }

  const tokenJson = await res.json() as { access_token?: string; refresh_token?: string };
  if (!tokenJson.access_token) {
    throw new Error('microsoft_token_refresh_failed: no access_token in response');
  }

  const result: { accessToken: string; newEncryptedRefreshToken?: string } = {
    accessToken: tokenJson.access_token,
  };

  if (tokenJson.refresh_token) {
    result.newEncryptedRefreshToken = encryptForUser(userId, tokenJson.refresh_token);
  }

  return result;
}

async function persistOutlookMessage(
  supabase: SupabaseClientAny,
  userId: string,
  msg: GraphMessage,
): Promise<void> {
  const bodyContent = msg.body?.content ?? '';
  const bodyEncrypted = encryptForUser(userId, bodyContent);

  const { error } = await supabase.from('email_messages').upsert(
    {
      user_id: userId,
      provider: 'outlook',
      provider_message_id: msg.id,
      internet_message_id: msg.internetMessageId ?? null,
      conversation_id: msg.conversationId ?? null,
      subject_hash: subjectHashOutlook(msg.subject),
      sender_domain: senderDomain(msg),
      received_at: msg.receivedDateTime ?? null,
      body_encrypted: bodyEncrypted,
    },
    { onConflict: 'user_id,provider,provider_message_id' },
  );
  if (error) throw new Error(`persistOutlookMessage: ${error.message}`);
}

async function saveOutlookDeltaToken(
  supabase: SupabaseClientAny,
  userId: string,
  token: string,
): Promise<void> {
  const { error } = await supabase.from('email_sync_state').upsert(
    {
      user_id: userId,
      provider: 'outlook',
      delta_token: token,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' },
  );
  if (error) throw new Error(`saveOutlookDeltaToken: ${error.message}`);
}

async function outlookIncremental(
  supabase: SupabaseClientAny,
  userId: string,
  startToken: string,
): Promise<{ processed: number; newDeltaToken: string | null }> {
  // Load encrypted refresh token (service-role bypasses RLS — approved exception §4.1).
  const { data: tokenRow, error: tokenError } = await supabase
    .from('oauth_tokens')
    .select('encrypted_refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'microsoft')
    .maybeSingle();
  if (tokenError) throw new Error(`oauth_tokens fetch: ${tokenError.message}`);
  if (!tokenRow) throw new Error('Outlook not connected — no oauth token found');

  const { accessToken, newEncryptedRefreshToken } = await refreshMicrosoftToken(
    (tokenRow as { encrypted_refresh_token: string }).encrypted_refresh_token,
    userId,
  );

  // If Microsoft rotated the refresh token, persist the new ciphertext.
  if (newEncryptedRefreshToken) {
    await supabase
      .from('oauth_tokens')
      .update({ encrypted_refresh_token: newEncryptedRefreshToken })
      .eq('user_id', userId)
      .eq('provider', 'microsoft');
  }

  const client = buildGraphClient(accessToken);
  const pacer = new GraphPacer();
  let processed = 0;
  let url: string | null = startToken;
  let deltaLink: string | null = null;

  while (url) {
    const wait = pacer.delayBeforeNext();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    const res = await withRetry(() =>
      client.api(url as string).get() as Promise<{
        value?: GraphMessage[];
        '@odata.nextLink'?: string;
        '@odata.deltaLink'?: string;
      }>,
    );
    pacer.record();

    for (const msg of res.value ?? []) {
      await persistOutlookMessage(supabase, userId, msg);
      processed++;
    }

    if (res['@odata.deltaLink']) {
      deltaLink = res['@odata.deltaLink'];
      url = null;
    } else {
      url = res['@odata.nextLink'] ?? null;
    }
  }

  if (deltaLink) await saveOutlookDeltaToken(supabase, userId, deltaLink);
  return { processed, newDeltaToken: deltaLink };
}

// ── Deno.serve entry point ────────────────────────────────────────────────

// @ts-ignore Deno.serve — not available in Node type-checking context.
_Deno && Deno.serve(async (req: Request): Promise<Response> => {
  // Service-role client — bypasses RLS intentionally (internal cron processor §4.1).
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const deps: DeltaSyncDeps = {
    validateSecret(header: string): boolean {
      if (!CRON_SECRET) return false;
      return header === `Bearer ${CRON_SECRET}`;
    },

    async fetchReadyUsers(limit: number) {
      // Fetch users whose backfill is complete: historyId set (Gmail) OR deltaToken set (Outlook).
      // A single user may have both Gmail and Outlook rows — both are returned.
      const { data, error } = await supabase
        .from('email_sync_state')
        .select('user_id, provider, history_id, delta_token')
        .or('history_id.not.is.null,delta_token.not.is.null')
        .limit(Math.min(limit, DELTA_BATCH_LIMIT));

      if (error) throw new Error(`fetchReadyUsers: ${error.message}`);
      return (data ?? []) as ReturnType<typeof deps.fetchReadyUsers> extends Promise<infer T> ? T : never;
    },

    async runGmailIncremental(userId: string, historyId: string) {
      return gmailIncremental(supabase, userId, historyId);
    },

    async runOutlookIncremental(userId: string, deltaToken: string) {
      return outlookIncremental(supabase, userId, deltaToken);
    },
  };

  return handleDeltaSyncRequest(req, deps);
});
