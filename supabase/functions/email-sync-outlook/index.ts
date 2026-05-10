/**
 * AINBOX-27: email-sync-outlook — Supabase Edge Function (Deno 2).
 *
 * PRD anchors:
 *   §3.8 Email APIs — @microsoft/microsoft-graph-client is the locked Outlook SDK.
 *   §4.2 OAuth token storage — refresh token loaded from `oauth_tokens`, decrypted in-memory.
 *   §4.3 Email content handling — bodies encrypted before storage, never logged in plaintext.
 *   §7.4 Email sync — Outlook backfill — up to 1,000 messages with Graph pacer.
 *   §7.5 Email sync — incremental — uses `delta_token` from `email_sync_state`.
 *   §7.17 Error handling — exponential backoff up to 6 attempts.
 *   §7.18 Rate-limit handling — Graph 10k req / 10-min sliding-window pacer.
 *
 * Security contract:
 *   - JWT from Authorization header is forwarded to Supabase client; RLS enforces tenant isolation.
 *   - Refresh token is decrypted in-memory using AES-256-GCM + HKDF-SHA256; never logged.
 *   - Email bodies encrypted with encryptForUser before being stored.
 *   - Service-role key is NEVER used; all DB access is scoped to auth.uid().
 *
 * Invocation:
 *   POST /functions/v1/email-sync-outlook
 *   Authorization: Bearer <user-jwt>
 *
 * Response (200):
 *   { mode: "backfill"|"incremental", userId, processed, deltaToken, durationMs }
 */

// @ts-ignore Deno global — not available in Node type-checking context.
const _Deno = typeof Deno !== 'undefined' ? Deno : undefined;

import { createClient } from 'npm:@supabase/supabase-js@2';
import { Client, type ClientOptions } from 'npm:@microsoft/microsoft-graph-client@3';
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
// Microsoft token refresh (§4.2 — server-side only, never client-facing)
// ---------------------------------------------------------------------------

const MS_TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MS_SCOPES = 'Mail.Read Mail.Send User.Read offline_access';

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

  const json = await res.json() as { access_token?: string; refresh_token?: string };
  if (!json.access_token) {
    throw new Error('microsoft_token_refresh_failed: no access_token in response');
  }

  const result: { accessToken: string; newEncryptedRefreshToken?: string } = {
    accessToken: json.access_token,
  };

  // MS Graph may rotate the refresh token (sliding-window); re-encrypt if present.
  if (json.refresh_token) {
    result.newEncryptedRefreshToken = encryptForUser(userId, json.refresh_token);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Graph rate-limit pacer — 10k req / 10-min sliding window (§7.18)
// ---------------------------------------------------------------------------

const GRAPH_WINDOW_MS = 10 * 60 * 1000;
const GRAPH_SOFT_LIMIT = Math.floor(10_000 * 0.9); // 9,000 — stay below ceiling

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

// ---------------------------------------------------------------------------
// Retry — exponential backoff up to 6 attempts, honours Retry-After (§7.17)
// ---------------------------------------------------------------------------

const MAX_RETRIES = 6;

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const status =
        (err as { statusCode?: number }).statusCode ??
        (err as { status?: number }).status;
      const retryAfterHeader =
        ((err as { headers?: Record<string, string> }).headers ?? {})['retry-after'] ??
        ((err as { headers?: Record<string, string> }).headers ?? {})['Retry-After'];
      const transient =
        status === 429 || (typeof status === 'number' && status >= 500 && status < 600);
      if (!transient || attempt === MAX_RETRIES) throw err;
      const backoffMs = retryAfterHeader
        ? Number(retryAfterHeader) * 1000
        : Math.min(30_000, 2 ** attempt * 250);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Graph helpers
// ---------------------------------------------------------------------------

const BACKFILL_TARGET = 1000;
const GRAPH_PAGE_SIZE = 100;

interface GraphMessage {
  id: string;
  subject?: string | null;
  receivedDateTime?: string | null;
  from?: { emailAddress?: { address?: string } } | null;
  body?: { content?: string } | null;
  internetMessageId?: string | null;
  conversationId?: string | null;
}

function subjectHash(s: string | null | undefined): string {
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

// ---------------------------------------------------------------------------
// Supabase storage adapter
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientAny = ReturnType<typeof createClient<any>>;

async function persistMessage(
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
      subject_hash: subjectHash(msg.subject),
      sender_domain: senderDomain(msg),
      received_at: msg.receivedDateTime ?? null,
      body_encrypted: bodyEncrypted,
    },
    { onConflict: 'user_id,provider,provider_message_id' },
  );
  if (error) throw new Error(`persistMessage: ${error.message}`);
}

async function saveDeltaToken(
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
  if (error) throw new Error(`saveDeltaToken: ${error.message}`);
}

async function loadDeltaToken(
  supabase: SupabaseClientAny,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('email_sync_state')
    .select('delta_token')
    .eq('user_id', userId)
    .eq('provider', 'outlook')
    .maybeSingle();
  return (data?.delta_token as string | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Sync orchestration
// ---------------------------------------------------------------------------

const SELECT_FIELDS =
  'id,subject,receivedDateTime,from,body,internetMessageId,conversationId';

async function runBackfill(
  client: Client,
  supabase: SupabaseClientAny,
  userId: string,
): Promise<{ processed: number; deltaToken: string | null }> {
  const pacer = new GraphPacer();
  let processed = 0;
  let url: string | null =
    `/me/messages?$top=${GRAPH_PAGE_SIZE}&$select=${encodeURIComponent(SELECT_FIELDS)}`;

  while (url && processed < BACKFILL_TARGET) {
    const wait = pacer.delayBeforeNext();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    const res = await withRetry(() =>
      client.api(url as string).get() as Promise<{
        value: GraphMessage[];
        '@odata.nextLink'?: string;
      }>,
    );
    pacer.record();

    for (const msg of res.value ?? []) {
      if (processed >= BACKFILL_TARGET) break;
      await persistMessage(supabase, userId, msg);
      processed++;
    }

    url = res['@odata.nextLink'] ?? null;
  }

  // Seed delta token after backfill — walk /me/messages/delta to get the deltaLink.
  const deltaToken = await seedDeltaToken(client, supabase, userId, pacer);
  return { processed, deltaToken };
}

async function seedDeltaToken(
  client: Client,
  supabase: SupabaseClientAny,
  userId: string,
  pacer: GraphPacer,
): Promise<string | null> {
  let url: string | null = `/me/messages/delta?$top=${GRAPH_PAGE_SIZE}`;
  let deltaLink: string | null = null;

  while (url) {
    const wait = pacer.delayBeforeNext();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    const res = await withRetry(() =>
      client.api(url as string).get() as Promise<{
        '@odata.nextLink'?: string;
        '@odata.deltaLink'?: string;
      }>,
    );
    pacer.record();

    if (res['@odata.deltaLink']) {
      deltaLink = res['@odata.deltaLink'];
      break;
    }
    url = res['@odata.nextLink'] ?? null;
  }

  if (deltaLink) await saveDeltaToken(supabase, userId, deltaLink);
  return deltaLink;
}

async function runIncremental(
  client: Client,
  supabase: SupabaseClientAny,
  userId: string,
  startToken: string,
): Promise<{ processed: number; deltaToken: string | null }> {
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
      await persistMessage(supabase, userId, msg);
      processed++;
    }

    if (res['@odata.deltaLink']) {
      deltaLink = res['@odata.deltaLink'];
      url = null;
    } else {
      url = res['@odata.nextLink'] ?? null;
    }
  }

  if (deltaLink) await saveDeltaToken(supabase, userId, deltaLink);
  return { processed, deltaToken: deltaLink };
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
      .eq('provider', 'microsoft')
      .maybeSingle();
    if (tokenError) return jsonResponse({ error: tokenError.message }, 500);
    if (!tokenRow) {
      return jsonResponse({ error: 'Outlook not connected — no oauth token found' }, 400);
    }

    // Refresh the MS access token in-memory (§4.2 — never persisted as plaintext).
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

    // Determine sync mode — delta token present → incremental, else backfill.
    const deltaToken = await loadDeltaToken(supabase, userId);
    const mode = deltaToken ? 'incremental' : 'backfill';

    // Build the Graph client (access token minted in-memory, §4.2).
    const client = buildGraphClient(accessToken);

    // Run the sync.
    const result = mode === 'backfill'
      ? await runBackfill(client, supabase, userId)
      : await runIncremental(client, supabase, userId, deltaToken!);

    return jsonResponse({
      mode,
      userId,
      processed: result.processed,
      deltaToken: result.deltaToken,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    const status = message.toLowerCase().includes('not connected') ? 400 : 500;
    return jsonResponse({ error: message }, status);
  }
});
