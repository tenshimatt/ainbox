/**
 * AINBOX-5: Gmail backfill + incremental delta sync worker.
 *
 * PRD anchors:
 *   §3.8 Email APIs — `googleapis` is the locked Gmail SDK.
 *   §4.2 OAuth token storage — refresh token read from `oauth_tokens` (depends on AINBOX-4 migration).
 *   §4.3 Email content handling — body persisted only via `encryptForUser` (never plaintext on disk).
 *   §7.3 Email sync — Gmail backfill — pulls last 1,000 messages, persists metadata + encrypted body,
 *        emits per-batch progress event, resumable on failure.
 *   §7.5 Email sync — incremental — uses `historyId` from `email_sync_state` for delta sync.
 *   §7.17 Error handling — exponential backoff up to 6 attempts on 5xx/429.
 *   §7.18 Rate-limit handling — paced under 250 quota units / user / second.
 *
 * Module shape:
 *   The worker accepts an injectable `deps` object (gmail client, supabase client, sleep,
 *   realtime emitter). The route handlers wire production deps; tests inject mocks at the
 *   network boundary so we never hit real Google or Supabase.
 *
 * NOTE: `oauth_tokens` and `email_sync_state` tables are assumed to exist. If AINBOX-4
 * migration has not yet landed, the route handlers will surface a clear error from the
 * supabase-js call rather than crashing. (depends on AINBOX-4 migration)
 */

import type { gmail_v1 } from 'googleapis';
import { encryptForUser } from '@/lib/crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const BACKFILL_TARGET = 1000;
export const BATCH_SIZE = 100;
/** Gmail per-user-per-second quota: 250 quota units. `messages.get` costs 5 units. */
export const QUOTA_UNITS_PER_SECOND = 250;
export const COST_MESSAGES_LIST = 5;
export const COST_MESSAGES_GET = 5;
export const COST_HISTORY_LIST = 2;
export const MAX_RETRY_ATTEMPTS = 6;

export interface GmailLikeClient {
  users: {
    messages: {
      list(params: gmail_v1.Params$Resource$Users$Messages$List): Promise<{ data: gmail_v1.Schema$ListMessagesResponse }>;
      get(params: gmail_v1.Params$Resource$Users$Messages$Get): Promise<{ data: gmail_v1.Schema$Message }>;
    };
    history: {
      list(params: gmail_v1.Params$Resource$Users$History$List): Promise<{ data: gmail_v1.Schema$ListHistoryResponse }>;
    };
  };
}

export interface SyncStorage {
  /** Persist a single message row. Idempotent on (user_id, gmail_id). */
  persistMessage(row: PersistedMessageRow): Promise<void>;
  /** Update the user's sync state (history id + last sync timestamp). */
  updateSyncState(userId: string, state: { historyId?: string | null; backfillCompleteAt?: string | null; lastSyncedAt?: string }): Promise<void>;
  /** Fetch the sync state for incremental sync. Returns null if backfill never ran. */
  getSyncState(userId: string): Promise<{ historyId: string | null } | null>;
}

export interface ProgressEmitter {
  /** Emit a per-batch progress event via Supabase Realtime (or any pubsub). */
  emit(userId: string, payload: SyncProgressPayload): Promise<void>;
}

export interface SyncProgressPayload {
  phase: 'backfill' | 'incremental';
  processed: number;
  target: number;
  batchSize: number;
  attempt?: number;
  done: boolean;
  errorCode?: string;
}

export interface PersistedMessageRow {
  user_id: string;
  gmail_id: string;
  thread_id: string | null;
  internal_date: string | null;
  from_addr: string | null;
  to_addr: string | null;
  subject: string | null;
  subject_hash: string | null;
  /** Encrypted body — NEVER plaintext. */
  body_encrypted: string;
  /** First ~400 chars of body, plaintext, used as prompt context. */
  body_preview: string | null;
  size_bytes: number;
  label_ids: string[];
  received_at: string | null;
  is_outbound: boolean;
  provider: 'gmail';
  // Eligibility headers (L1.7) — used by draftable_candidates() rules.
  cc_addrs: string[] | null;
  bcc_addrs: string[] | null;
  reply_to: string | null;
  list_id: string | null;
  list_unsubscribe: string | null;
  auto_submitted: string | null;
  precedence: string | null;
  recipient_count: number;
}

export interface SyncDeps {
  gmail: GmailLikeClient;
  storage: SyncStorage;
  progress: ProgressEmitter;
  /** Override for tests; default uses real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Override for tests; default uses Date.now. */
  now?: () => number;
  /**
   * TASK7544-79: Called once, fire-and-forget, after the first batch of messages
   * is persisted during a backfill. Used to kick classify + draft immediately so
   * the user sees their first draft within 4 minutes rather than waiting for
   * the next pg_cron cycle.
   */
  pipelineKick?: (userId: string) => Promise<void>;
}

export interface BackfillResult {
  userId: string;
  processed: number;
  target: number;
  historyId: string | null;
  attempts: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Compute backoff in ms for a retry attempt (1-indexed). 1s, 2s, 4s, 8s, 16s, 32s. */
export function backoffMs(attempt: number): number {
  return Math.min(32_000, 2 ** (attempt - 1) * 1000);
}

/** Hash a subject (for log-safe metadata per §4.3). Lightweight FNV-1a, not cryptographic. */
function hashSubject(s: string | null | undefined): string | null {
  if (!s) return null;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return `fnv1a:${h.toString(16)}`;
}

function headerValue(payload: gmail_v1.Schema$MessagePart | undefined, name: string): string | null {
  if (!payload?.headers) return null;
  const h = payload.headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

/** Recursively concatenate all decoded text/* parts of a Gmail payload. */
export function extractBody(message: gmail_v1.Schema$Message): string {
  const out: string[] = [];
  const visit = (part?: gmail_v1.Schema$MessagePart) => {
    if (!part) return;
    if (part.body?.data) {
      const buf = Buffer.from(part.body.data, 'base64url');
      out.push(buf.toString('utf8'));
    }
    if (part.parts) part.parts.forEach(visit);
  };
  visit(message.payload ?? undefined);
  return out.join('\n');
}

/** Detect 5xx / 429 / network class errors that warrant a retry. */
export function isRetryable(err: unknown): boolean {
  if (!err) return false;
  // googleapis errors expose `.code` (number) and `.response.status`.
  const e = err as { code?: number | string; response?: { status?: number }; status?: number };
  const status = (typeof e.code === 'number' ? e.code : undefined) ?? e.response?.status ?? e.status;
  if (typeof status === 'number') {
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return false;
  }
  // Network-class string codes.
  if (typeof e.code === 'string' && ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'].includes(e.code)) {
    return true;
  }
  return false;
}

/**
 * Run `fn` with exponential backoff. Up to MAX_RETRY_ATTEMPTS attempts. Re-throws the
 * last error if all attempts fail OR the error is non-retryable. Returns `{result, attempts}`.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { sleep?: (ms: number) => Promise<void>; onAttempt?: (attempt: number, err: unknown) => void } = {},
): Promise<{ result: T; attempts: number }> {
  const sleep = opts.sleep ?? defaultSleep;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const result = await fn();
      return { result, attempts: attempt };
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_RETRY_ATTEMPTS) {
        throw err;
      }
      opts.onAttempt?.(attempt, err);
      await sleep(backoffMs(attempt));
    }
  }
  // Unreachable, but TS likes it.
  throw lastErr;
}

/**
 * Token-bucket pacer that keeps us safely under Gmail's 250-quota-units/sec limit.
 * Refills `QUOTA_UNITS_PER_SECOND` units every 1000ms. `consume(n)` blocks until
 * enough units are available.
 */
export class QuotaPacer {
  private tokens: number;
  private last: number;
  private readonly capacity = QUOTA_UNITS_PER_SECOND;
  constructor(private readonly sleep: (ms: number) => Promise<void> = defaultSleep, private readonly nowFn: () => number = Date.now) {
    this.tokens = this.capacity;
    this.last = this.nowFn();
  }
  async consume(units: number): Promise<void> {
    while (true) {
      const now = this.nowFn();
      const elapsed = (now - this.last) / 1000;
      if (elapsed > 0) {
        this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.capacity);
        this.last = now;
      }
      if (this.tokens >= units) {
        this.tokens -= units;
        return;
      }
      const deficit = units - this.tokens;
      const waitMs = Math.max(1, Math.ceil((deficit / this.capacity) * 1000));
      await this.sleep(waitMs);
    }
  }
}

function splitAddrs(raw: string | null): string[] | null {
  if (!raw) return null;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : null;
}

function rowFromMessage(userId: string, message: gmail_v1.Schema$Message): PersistedMessageRow {
  const body = extractBody(message);
  const subject = headerValue(message.payload ?? undefined, 'Subject');
  const labelIds = message.labelIds ?? [];
  const internalDate = message.internalDate ?? null;
  const toAddr = headerValue(message.payload ?? undefined, 'To');
  const ccRaw = headerValue(message.payload ?? undefined, 'Cc');
  const bccRaw = headerValue(message.payload ?? undefined, 'Bcc');
  const cc = splitAddrs(ccRaw);
  const bcc = splitAddrs(bccRaw);
  const toCount = splitAddrs(toAddr)?.length ?? 0;
  return {
    user_id: userId,
    gmail_id: message.id ?? '',
    thread_id: message.threadId ?? null,
    internal_date: internalDate,
    from_addr: headerValue(message.payload ?? undefined, 'From'),
    to_addr: toAddr,
    subject: subject ?? null,
    subject_hash: hashSubject(subject),
    body_encrypted: encryptForUser(userId, body),
    body_preview: body
      ? body.replace(/\s+/g, ' ').trim().slice(0, 400)
      : null,
    size_bytes: message.sizeEstimate ?? 0,
    label_ids: labelIds,
    received_at: internalDate ? new Date(Number(internalDate)).toISOString() : null,
    is_outbound: labelIds.includes('SENT'),
    provider: 'gmail',
    cc_addrs: cc,
    bcc_addrs: bcc,
    reply_to: headerValue(message.payload ?? undefined, 'Reply-To'),
    list_id: headerValue(message.payload ?? undefined, 'List-Id'),
    list_unsubscribe: headerValue(message.payload ?? undefined, 'List-Unsubscribe'),
    auto_submitted: headerValue(message.payload ?? undefined, 'Auto-Submitted'),
    precedence: headerValue(message.payload ?? undefined, 'Precedence'),
    recipient_count: toCount + (cc?.length ?? 0) + (bcc?.length ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Backfill (§7.3)
// ---------------------------------------------------------------------------

/**
 * Run a Gmail backfill for `userId`. Pulls up to BACKFILL_TARGET messages, persists each
 * with body encrypted via `encryptForUser`, and emits per-batch progress events.
 *
 * Resumable: a partial run can be re-invoked; the storage layer must enforce
 * idempotency on (user_id, gmail_id) via UPSERT.
 */
export async function runGmailBackfill(userId: string, deps: SyncDeps): Promise<BackfillResult> {
  if (!userId) throw new Error('runGmailBackfill: userId required');
  const start = (deps.now ?? Date.now)();
  const sleep = deps.sleep ?? defaultSleep;
  const pacer = new QuotaPacer(sleep, deps.now);

  let processed = 0;
  let pageToken: string | undefined;
  let highestHistoryId: string | null = null;
  let attemptsTotal = 0;
  let pipelineKicked = false;

  while (processed < BACKFILL_TARGET) {
    await pacer.consume(COST_MESSAGES_LIST);
    const remaining = BACKFILL_TARGET - processed;
    const pageSize = Math.min(BATCH_SIZE, remaining);

    const { result: listResp, attempts: listAttempts } = await withRetry(
      () =>
        deps.gmail.users.messages.list({
          userId: 'me',
          maxResults: pageSize,
          pageToken,
        }),
      { sleep },
    );
    attemptsTotal += listAttempts;

    const ids = (listResp.data.messages ?? []).map((m) => m.id).filter((x): x is string => Boolean(x));
    if (ids.length === 0) break;

    for (const id of ids) {
      await pacer.consume(COST_MESSAGES_GET);
      const { result: msgResp, attempts: getAttempts } = await withRetry(
        () => deps.gmail.users.messages.get({ userId: 'me', id, format: 'full' }),
        { sleep },
      );
      attemptsTotal += getAttempts;
      const message = msgResp.data;
      const row = rowFromMessage(userId, message);
      await deps.storage.persistMessage(row);
      if (message.historyId && (!highestHistoryId || BigInt(message.historyId) > BigInt(highestHistoryId))) {
        highestHistoryId = message.historyId;
      }
      processed++;
      if (processed >= BACKFILL_TARGET) break;
    }

    // TASK7544-79: kick classify + draft in parallel after the first batch
    // so the user gets their first draft in < 4 min instead of waiting for cron.
    if (!pipelineKicked && processed > 0 && deps.pipelineKick) {
      pipelineKicked = true;
      void deps.pipelineKick(userId).catch((err) => {
        console.error('[sync/gmail] pipelineKick threw:', (err as Error).message);
      });
    }

    await deps.progress.emit(userId, {
      phase: 'backfill',
      processed,
      target: BACKFILL_TARGET,
      batchSize: ids.length,
      done: false,
    });

    pageToken = listResp.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  await deps.storage.updateSyncState(userId, {
    historyId: highestHistoryId,
    backfillCompleteAt: processed >= BACKFILL_TARGET ? new Date().toISOString() : null,
    lastSyncedAt: new Date().toISOString(),
  });

  await deps.progress.emit(userId, {
    phase: 'backfill',
    processed,
    target: BACKFILL_TARGET,
    batchSize: 0,
    done: true,
  });

  const end = (deps.now ?? Date.now)();
  return {
    userId,
    processed,
    target: BACKFILL_TARGET,
    historyId: highestHistoryId,
    attempts: attemptsTotal,
    durationMs: end - start,
  };
}

// ---------------------------------------------------------------------------
// Incremental delta sync (§7.5)
// ---------------------------------------------------------------------------

export interface IncrementalResult {
  userId: string;
  newOrChanged: number;
  newHistoryId: string | null;
}

/**
 * Run a delta-sync since the last `historyId` stored in `email_sync_state`.
 *
 * If the state row is missing or has a null history id, we throw — the caller should
 * run a backfill first (§7.3 must precede §7.5).
 */
export async function runGmailIncremental(userId: string, deps: SyncDeps): Promise<IncrementalResult> {
  if (!userId) throw new Error('runGmailIncremental: userId required');
  const sleep = deps.sleep ?? defaultSleep;
  const pacer = new QuotaPacer(sleep, deps.now);

  const state = await deps.storage.getSyncState(userId);
  if (!state || !state.historyId) {
    throw new Error('runGmailIncremental: no historyId — run backfill first (§7.3)');
  }

  let pageToken: string | undefined;
  let processed = 0;
  let newHistoryId = state.historyId;

  while (true) {
    await pacer.consume(COST_HISTORY_LIST);
    const { result: histResp } = await withRetry(
      () =>
        deps.gmail.users.history.list({
          userId: 'me',
          startHistoryId: state.historyId!,
          historyTypes: ['messageAdded', 'labelAdded', 'labelRemoved'],
          pageToken,
        }),
      { sleep },
    );

    const records = histResp.data.history ?? [];
    const messageIds = new Set<string>();
    for (const h of records) {
      for (const m of h.messagesAdded ?? []) {
        if (m.message?.id) messageIds.add(m.message.id);
      }
      for (const m of h.messages ?? []) {
        if (m.id) messageIds.add(m.id);
      }
    }

    for (const id of messageIds) {
      await pacer.consume(COST_MESSAGES_GET);
      const { result: msgResp } = await withRetry(
        () => deps.gmail.users.messages.get({ userId: 'me', id, format: 'full' }),
        { sleep },
      );
      const message = msgResp.data;
      await deps.storage.persistMessage(rowFromMessage(userId, message));
      processed++;
      if (message.historyId && BigInt(message.historyId) > BigInt(newHistoryId)) {
        newHistoryId = message.historyId;
      }
    }

    if (histResp.data.historyId && BigInt(histResp.data.historyId) > BigInt(newHistoryId)) {
      newHistoryId = histResp.data.historyId;
    }

    await deps.progress.emit(userId, {
      phase: 'incremental',
      processed,
      target: processed,
      batchSize: messageIds.size,
      done: false,
    });

    pageToken = histResp.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  await deps.storage.updateSyncState(userId, {
    historyId: newHistoryId,
    lastSyncedAt: new Date().toISOString(),
  });

  await deps.progress.emit(userId, {
    phase: 'incremental',
    processed,
    target: processed,
    batchSize: 0,
    done: true,
  });

  return { userId, newOrChanged: processed, newHistoryId };
}

// ---------------------------------------------------------------------------
// Production deps factory (used by the route handlers)
// ---------------------------------------------------------------------------

/**
 * Build a Gmail client from a refresh token. The refresh token is loaded from
 * `oauth_tokens` (depends on AINBOX-4 migration). Access tokens are minted at
 * request time and never persisted — per §4.2.
 */
export async function buildGmailClient(refreshToken: string): Promise<GmailLikeClient> {
  // Lazy-load googleapis so tests that mock at the module boundary don't pay
  // the import cost.
  const { google } = await import('googleapis');
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: oauth2 }) as unknown as GmailLikeClient;
}
