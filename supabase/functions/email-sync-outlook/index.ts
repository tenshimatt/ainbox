/**
 * email-sync-outlook — Supabase Edge Function
 *
 * PRD: §4.6 (edge function naming), §7.4 (Outlook backfill), §7.5 (delta seed),
 *      §4.2 (refresh tokens server-side only), §4.3 (body encryption at rest),
 *      §7.17 (retry/backoff), §7.18 (Graph rate limiting)
 *
 * Invocation:
 *   POST /functions/v1/email-sync-outlook
 *   Authorization: Bearer <supabase_jwt>
 *
 * Triggered by pg_cron (§7.5) or manually after OAuth connect.
 * Paginates /me/messages?$top=100 via MS Graph up to 1000 messages,
 * encrypts bodies with AES-256-GCM (matching src/lib/crypto.ts format),
 * persists to email_messages, then seeds the delta token for incremental sync.
 *
 * Architecture constraints:
 *  - RLS-scoped Supabase client (anon key + user JWT). No service-role.
 *  - Refresh tokens never leave the server boundary (§4.2).
 *  - Bodies never logged in plaintext (§4.3).
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const BACKFILL_CAP = 1000;
const PAGE_SIZE = 100;
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
// Graph: 10k requests per 10 minutes; hold to 90% safety margin (§7.18).
const GRAPH_WINDOW_MS = 10 * 60 * 1000;
const GRAPH_SOFT_LIMIT = 9_000;

// ---------------------------------------------------------------------------
// AES-256-GCM encryption (Web Crypto — Deno-native)
// Output format: `v1.<iv_b64>.<tag_b64>.<ct_b64>` — must match src/lib/crypto.ts.
// ---------------------------------------------------------------------------

function getMasterKey(): Uint8Array {
  const raw = Deno.env.get('AINBOX_ENC_MASTER_KEY') ?? '';
  if (!raw || raw.length < 32) {
    throw new Error('AINBOX_ENC_MASTER_KEY must be set (≥32 bytes)');
  }
  // Accept hex, base64, or raw UTF-8 — normalise to Uint8Array.
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0) {
    const bytes = new Uint8Array(raw.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  // Try base64
  try {
    const decoded = atob(raw);
    if (decoded.length >= 32) {
      return new TextEncoder().encode(decoded);
    }
  } catch { /* not base64 */ }
  return new TextEncoder().encode(raw);
}

async function encryptForUser(userId: string, plaintext: string): Promise<string> {
  const masterBytes = getMasterKey();
  const masterKey = await crypto.subtle.importKey(
    'raw', masterBytes, 'HKDF', false, ['deriveKey'],
  );
  const userKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(userId),
      info: new TextEncoder().encode('ainbox-v1'),
    },
    masterKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctWithTag = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(userId),
      tagLength: 128,
    },
    userKey,
    new TextEncoder().encode(plaintext),
  );
  // Web Crypto GCM appends the auth tag at the end: ctWithTag = ct || tag.
  const buf = new Uint8Array(ctWithTag);
  const tag = buf.slice(buf.length - 16);
  const ct = buf.slice(0, buf.length - 16);
  const b64 = (a: Uint8Array) => btoa(String.fromCharCode(...a));
  return `v1.${b64(iv)}.${b64(tag)}.${b64(ct)}`;
}

// ---------------------------------------------------------------------------
// Microsoft Graph helpers
// ---------------------------------------------------------------------------

interface GraphMessage {
  id: string;
  subject?: string | null;
  receivedDateTime?: string | null;
  from?: { emailAddress?: { address?: string } } | null;
  body?: { contentType?: string; content?: string } | null;
  internetMessageId?: string | null;
  conversationId?: string | null;
}

interface GraphPageResponse {
  value?: GraphMessage[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

// Retry helper — honours Retry-After header (§7.17, §7.18).
async function withRetry<T>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
  maxAttempts = 6,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const status =
        (err as { status?: number }).status ??
        (err as { statusCode?: number }).statusCode;
      const retryAfter =
        (err as { headers?: Record<string, string> }).headers?.['retry-after'] ??
        (err as { headers?: Record<string, string> }).headers?.['Retry-After'];
      const transient =
        status === 429 || (typeof status === 'number' && status >= 500 && status < 600);
      if (!transient || attempt === maxAttempts) throw err;
      const backoffMs = retryAfter
        ? Number(retryAfter) * 1000
        : Math.min(30_000, 2 ** attempt * 250);
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

async function graphFetch(
  url: string,
  accessToken: string,
  sleep: (ms: number) => Promise<void>,
): Promise<GraphPageResponse> {
  return withRetry(async () => {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const retryAfter = res.headers.get('Retry-After') ?? undefined;
      const err = Object.assign(
        new Error(`Graph ${res.status}: ${url}`),
        {
          status: res.status,
          headers: retryAfter ? { 'Retry-After': retryAfter } : {},
        },
      );
      throw err;
    }
    return res.json() as Promise<GraphPageResponse>;
  }, sleep);
}

// Simple rate pacer (process-local, suitable for single-invocation backfill).
class GraphPacer {
  private timestamps: number[] = [];
  delayBefore(now = Date.now()): number {
    const cutoff = now - GRAPH_WINDOW_MS;
    this.timestamps = this.timestamps.filter((t) => t > cutoff);
    if (this.timestamps.length < GRAPH_SOFT_LIMIT) return 0;
    return Math.max(0, this.timestamps[0] + GRAPH_WINDOW_MS - now);
  }
  record(now = Date.now()): void {
    this.timestamps.push(now);
  }
}

function subjectHash(subject: string | null | undefined): string {
  const s = subject ?? '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `h${(h >>> 0).toString(16)}`;
}

function senderDomain(msg: GraphMessage): string | null {
  const addr = msg.from?.emailAddress?.address;
  if (!addr) return null;
  const at = addr.lastIndexOf('@');
  return at < 0 ? null : addr.slice(at + 1).toLowerCase();
}

// ---------------------------------------------------------------------------
// Microsoft OAuth — exchange refresh token for access token.
// Uses MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_TENANT_ID
// from Supabase secrets (§4.2 — server-side only).
// ---------------------------------------------------------------------------

async function exchangeRefreshToken(refreshToken: string): Promise<string> {
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET') ?? '';
  const tenantId = Deno.env.get('MICROSOFT_TENANT_ID') ?? 'common';
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'https://graph.microsoft.com/Mail.Read offline_access',
  });
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Microsoft token exchange failed (${res.status}): ${text}`);
  }
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Core backfill — mirrors runOutlookBackfill from src/lib/sync/outlook.ts
// but uses fetch + Web Crypto instead of npm client + node:crypto.
// ---------------------------------------------------------------------------

interface BackfillResult {
  persisted: number;
  pages: number;
}

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

async function runBackfill(
  userId: string,
  accessToken: string,
  supabase: SupabaseClient,
  sleep: (ms: number) => Promise<void>,
): Promise<BackfillResult> {
  const pacer = new GraphPacer();
  const fields =
    'id,subject,receivedDateTime,from,body,bodyPreview,internetMessageId,conversationId';
  let url: string | null =
    `${GRAPH_BASE}/me/messages?$top=${PAGE_SIZE}&$select=${encodeURIComponent(fields)}`;
  let persisted = 0;
  let pages = 0;

  while (url && persisted < BACKFILL_CAP) {
    const wait = pacer.delayBefore();
    if (wait > 0) await sleep(wait);

    const page = await graphFetch(url, accessToken, sleep);
    pacer.record();
    pages += 1;

    for (const msg of page.value ?? []) {
      if (persisted >= BACKFILL_CAP) break;
      const bodyContent = msg.body?.content ?? '';
      const bodyEncrypted = await encryptForUser(userId, bodyContent);

      // Upsert to keep backfill idempotent / resumable (§7.3 / §7.4).
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
      if (error) throw new Error(`persist failed: ${error.message}`);
      persisted += 1;
    }

    url = page['@odata.nextLink'] ?? null;
  }

  // Seed delta token — walk /me/messages/delta until deltaLink appears (§7.5).
  await seedDeltaToken(userId, accessToken, supabase, sleep, pacer);

  return { persisted, pages };
}

async function seedDeltaToken(
  userId: string,
  accessToken: string,
  supabase: SupabaseClient,
  sleep: (ms: number) => Promise<void>,
  pacer: GraphPacer,
): Promise<void> {
  let url: string | null = `${GRAPH_BASE}/me/messages/delta?$top=${PAGE_SIZE}`;
  while (url) {
    const wait = pacer.delayBefore();
    if (wait > 0) await sleep(wait);

    const page = await graphFetch(url, accessToken, sleep);
    pacer.record();

    if (page['@odata.deltaLink']) {
      const { error } = await supabase.from('email_sync_state').upsert(
        {
          user_id: userId,
          provider: 'outlook',
          delta_token: page['@odata.deltaLink'],
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' },
      );
      if (error) throw new Error(`saveDeltaToken failed: ${error.message}`);
      return;
    }
    url = page['@odata.nextLink'] ?? null;
  }
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  // Validate user via Supabase JWT (RLS-scoped — no service-role, §4.1).
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData?.user) {
    return new Response(JSON.stringify({ error: 'unauthenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const userId = userData.user.id;

  // Load refresh token (RLS ensures we only see our own row).
  const { data: tokenRow, error: tokenError } = await supabase
    .from('oauth_tokens')
    .select('access_token')
    .eq('user_id', userId)
    .eq('provider', 'microsoft')
    .maybeSingle();

  if (tokenError || !tokenRow?.access_token) {
    // Try refresh token fallback
    const { data: rtRow, error: rtError } = await supabase
      .from('oauth_tokens')
      .select('encrypted_refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'outlook')
      .maybeSingle();
    if (rtError || !rtRow?.encrypted_refresh_token) {
      return new Response(
        JSON.stringify({ error: 'no_microsoft_token', detail: 'Connect Microsoft first' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    // Exchange refresh token for access token.
    let accessToken: string;
    try {
      accessToken = await exchangeRefreshToken(rtRow.encrypted_refresh_token as string);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'token_exchange_failed', detail: (err as Error).message }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }

    try {
      const result = await runBackfill(userId, accessToken, supabase, defaultSleep);
      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ ok: false, error: 'backfill_failed', detail: (err as Error).message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  // Use the cached access token directly.
  try {
    const result = await runBackfill(
      userId,
      tokenRow.access_token as string,
      supabase,
      defaultSleep,
    );
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: 'backfill_failed', detail: (err as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
