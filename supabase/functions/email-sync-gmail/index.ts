/**
 * AINBOX-26: Supabase Edge Function — email-sync-gmail.
 * Deno 2 runtime entry point.
 *
 * PRD anchors:
 *   §4.2  OAuth token — refresh token loaded from `oauth_tokens`; access token minted in-memory.
 *   §4.3  Encryption — body encrypted via AES-256-GCM (HKDF-SHA256 per-user key) before storage.
 *   §4.6  Background jobs — this function is the intended production runtime for §7.3.
 *   §7.3  Gmail backfill — pulls last 1,000 messages, persists encrypted bodies,
 *         emits per-batch Realtime progress events, resumable via UPSERT idempotency.
 *
 * Dependencies (resolved at Deno runtime):
 *   npm:@supabase/supabase-js@2  — Supabase JS client (RLS-scoped with user JWT).
 *   node:crypto                  — AES-256-GCM encryption (Deno 2 Node compat layer).
 *
 * Encryption output format: `v1.<iv_b64>.<tag_b64>.<ct_b64>` — bit-for-bit compatible
 * with src/lib/crypto.ts so the same `decryptForUser` helper can be used on the JS side.
 */

// @ts-ignore — Deno 2 npm: specifier; not available in Node.js tsc context.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createCipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { handleEdgeBackfill, type BackfillResult } from './handler.ts';

// ---------------------------------------------------------------------------
// Constants — mirror src/lib/sync/gmail.ts so behaviour stays aligned.
// ---------------------------------------------------------------------------

const BACKFILL_TARGET = 1000;
const BATCH_SIZE = 100;
const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

// ---------------------------------------------------------------------------
// Crypto — mirrors src/lib/crypto.ts exactly so ciphertexts are portable.
// ---------------------------------------------------------------------------

function getMasterKey(): Buffer {
  const raw = Deno.env.get('AINBOX_ENC_MASTER_KEY');
  if (!raw || raw.length < 32) {
    throw new Error('AINBOX_ENC_MASTER_KEY must be set (>=32 bytes)');
  }
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0) {
    return Buffer.from(raw, 'hex');
  }
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

/** AES-256-GCM encrypt for `userId`. Output: `v1.<iv>.<tag>.<ct>` (base64 parts). */
function encryptForUser(userId: string, plaintext: string): string {
  const key = deriveUserKey(userId);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(Buffer.from(userId, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

// ---------------------------------------------------------------------------
// Gmail REST helpers (fetch-based — avoids heavy googleapis npm package).
// ---------------------------------------------------------------------------

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? '',
      client_secret: Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') ?? '',
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Token refresh failed (${res.status}): ${txt}`);
  }
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

function hashSubject(s: string | null | undefined): string | null {
  if (!s) return null;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return `fnv1a:${h.toString(16)}`;
}

type GmailPart = { body?: { data?: string }; parts?: GmailPart[] };

function extractBodyParts(parts: GmailPart[] | undefined): string {
  if (!parts) return '';
  const out: string[] = [];
  for (const part of parts) {
    if (part.body?.data) {
      // Gmail uses base64url; atob expects standard base64.
      const b64 = part.body.data.replace(/-/g, '+').replace(/_/g, '/');
      out.push(atob(b64));
    }
    if (part.parts) out.push(extractBodyParts(part.parts));
  }
  return out.join('\n');
}

function extractBody(msg: { payload?: { body?: { data?: string }; parts?: GmailPart[] } }): string {
  if (!msg.payload) return '';
  if (msg.payload.body?.data) {
    const b64 = msg.payload.body.data.replace(/-/g, '+').replace(/_/g, '/');
    return atob(b64);
  }
  return extractBodyParts(msg.payload.parts);
}

function headerVal(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string | null {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

// ---------------------------------------------------------------------------
// Backfill implementation (§7.3)
// ---------------------------------------------------------------------------

async function runGmailBackfillEdge(
  userId: string,
  accessToken: string,
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<BackfillResult> {
  const start = Date.now();
  const authHeader = `Bearer ${accessToken}`;
  const base = 'https://gmail.googleapis.com/gmail/v1/users/me';

  let processed = 0;
  let pageToken: string | undefined;
  let highestHistoryId: string | null = null;

  while (processed < BACKFILL_TARGET) {
    const remaining = BACKFILL_TARGET - processed;
    const pageSize = Math.min(BATCH_SIZE, remaining);
    const url = new URL(`${base}/messages`);
    url.searchParams.set('maxResults', String(pageSize));
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const listRes = await fetch(url.toString(), { headers: { Authorization: authHeader } });
    if (!listRes.ok) throw new Error(`Gmail messages.list failed: ${listRes.status}`);
    const listData = await listRes.json() as {
      messages?: Array<{ id: string; threadId: string }>;
      nextPageToken?: string;
    };

    const ids = (listData.messages ?? []).map((m) => m.id).filter(Boolean);
    if (ids.length === 0) break;

    for (const id of ids) {
      const msgRes = await fetch(`${base}/messages/${id}?format=full`, {
        headers: { Authorization: authHeader },
      });
      if (!msgRes.ok) throw new Error(`Gmail messages.get(${id}) failed: ${msgRes.status}`);
      const msg = await msgRes.json() as {
        id?: string;
        threadId?: string;
        historyId?: string;
        internalDate?: string;
        sizeEstimate?: number;
        labelIds?: string[];
        payload?: { headers?: Array<{ name?: string; value?: string }>; body?: { data?: string }; parts?: GmailPart[] };
      };

      const body = extractBody(msg);
      const headers = msg.payload?.headers ?? [];
      const row = {
        user_id: userId,
        gmail_id: msg.id ?? id,
        thread_id: msg.threadId ?? null,
        internal_date: msg.internalDate ?? null,
        from_addr: headerVal(headers, 'From'),
        to_addr: headerVal(headers, 'To'),
        subject_hash: hashSubject(headerVal(headers, 'Subject')),
        body_encrypted: encryptForUser(userId, body),
        size_bytes: msg.sizeEstimate ?? 0,
        label_ids: msg.labelIds ?? [],
      };

      // UPSERT for idempotency / resumability (§7.3).
      const { error } = await supabase.from('email_messages').upsert(row, { onConflict: 'user_id,gmail_id' });
      if (error) throw error;

      if (msg.historyId && (!highestHistoryId || BigInt(msg.historyId) > BigInt(highestHistoryId))) {
        highestHistoryId = msg.historyId;
      }
      processed++;
      if (processed >= BACKFILL_TARGET) break;
    }

    // Per-batch Realtime progress event (§7.3 "emit per-batch progress event").
    await supabase.channel(`sync:${userId}`).send({
      type: 'broadcast',
      event: 'gmail-sync-progress',
      payload: { phase: 'backfill', processed, target: BACKFILL_TARGET, batchSize: ids.length, done: false },
    });

    pageToken = listData.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  // Persist sync state (historyId seeds the incremental §7.5 delta sync).
  const { error: stateErr } = await supabase.from('email_sync_state').upsert(
    {
      user_id: userId,
      provider: 'gmail',
      history_id: highestHistoryId,
      backfill_complete_at: processed >= BACKFILL_TARGET ? new Date().toISOString() : null,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' },
  );
  if (stateErr) throw stateErr;

  // Final done event.
  await supabase.channel(`sync:${userId}`).send({
    type: 'broadcast',
    event: 'gmail-sync-progress',
    payload: { phase: 'backfill', processed, target: BACKFILL_TARGET, batchSize: 0, done: true },
  });

  return { processed, historyId: highestHistoryId, durationMs: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Deno.serve entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authHeader = req.headers.get('Authorization');

  const { status, body } = await handleEdgeBackfill(authHeader, {
    async verifyAuth(header) {
      if (!header?.startsWith('Bearer ')) return null;
      const jwt = header.slice(7);
      // Create RLS-scoped client with the user's JWT (§4.1 tenant isolation).
      const client = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const { data: { user } } = await client.auth.getUser();
      return user?.id ?? null;
    },

    async loadRefreshToken(userId) {
      // Use the same JWT for RLS — no service-role usage in user-facing paths (§4.1).
      const jwt = authHeader!.slice(7);
      const client = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const { data, error } = await client
        .from('oauth_tokens')
        .select('refresh_token')
        .eq('user_id', userId)
        .eq('provider', 'gmail')
        .maybeSingle();
      if (error) throw error;
      return (data as { refresh_token: string } | null)?.refresh_token ?? null;
    },

    async runBackfill(userId, refreshToken): Promise<BackfillResult> {
      const jwt = authHeader!.slice(7);
      const supabase = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      // Access token minted in-memory, never persisted (§4.2).
      const accessToken = await refreshAccessToken(refreshToken);
      return await runGmailBackfillEdge(userId, accessToken, supabase);
    },
  });

  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
});
