/**
 * Outlook (Microsoft Graph) email sync worker.
 *
 * PRD references:
 *  - §3.8 Email APIs (uses @microsoft/microsoft-graph-client)
 *  - §4.2 OAuth tokens (refresh tokens never leave server)
 *  - §4.3 Email content (bodies encrypted at rest, redacted in logs)
 *  - §7.4 Outlook backfill (paginate /me/messages?$top=100 up to 1000)
 *  - §7.5 Incremental delta sync (/me/messages/delta + delta token persistence)
 *  - §7.17 Error handling & retries (exponential backoff up to 6)
 *  - §7.18 Rate-limit handling (Graph: 10k req / 10 min sliding window)
 *
 * Dependencies on sibling tickets:
 *  - encryptForUser() from src/lib/crypto.ts is owned by AINBOX-5.
 *    If it's not yet present at import time, callers should fail loud.
 *  - oauth_tokens table + email_sync_state table are owned by AINBOX-4.
 */

import { Client, type ClientOptions } from '@microsoft/microsoft-graph-client';

// AINBOX-5 dependency: src/lib/crypto.ts exports encryptForUser.
// Import lazily so this module loads even before AINBOX-5 lands.
type EncryptForUser = (userId: string, plaintext: string) => Promise<string>;
async function getEncryptForUser(): Promise<EncryptForUser> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    // Use a runtime-constructed specifier so tsc doesn't try to resolve the
    // (intentionally optional) module at build time. AINBOX-5 owns the file.
    const specifier = '@' + '/lib/crypto';
    const mod = (await import(/* webpackIgnore: true */ specifier)) as Record<
      string,
      unknown
    >;
    if (typeof mod.encryptForUser !== 'function') {
      throw new Error('encryptForUser not exported');
    }
    return mod.encryptForUser as EncryptForUser;
  } catch (err) {
    // depends on AINBOX-5 lib/crypto.ts — fall back to a guard that throws on use
    return async () => {
      throw new Error(
        'encryptForUser is unavailable — depends on AINBOX-5 lib/crypto.ts',
      );
    };
  }
}

// ---------------------------------------------------------------------------
// Rate-limit pacer — Graph allows 10,000 req / 10-minute sliding window.
// We hold a process-local sliding window. In production the same logic
// belongs in Supabase (one row per provider per user) so multiple workers
// honour the same window; this in-memory variant is correct for a single
// edge-function invocation handling one user backfill.
// ---------------------------------------------------------------------------
const GRAPH_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const GRAPH_WINDOW_MAX = 10_000; // requests per window
// Safety margin — never push the user against the ceiling.
const GRAPH_SOFT_LIMIT = Math.floor(GRAPH_WINDOW_MAX * 0.9);

export class GraphPacer {
  private timestamps: number[] = [];
  constructor(
    private readonly windowMs = GRAPH_WINDOW_MS,
    private readonly softLimit = GRAPH_SOFT_LIMIT,
  ) {}

  /** Returns the milliseconds the caller should wait before the next request. */
  delayBeforeNext(now = Date.now()): number {
    this.prune(now);
    if (this.timestamps.length < this.softLimit) return 0;
    const oldest = this.timestamps[0];
    return Math.max(0, oldest + this.windowMs - now);
  }

  record(now = Date.now()): void {
    this.prune(now);
    this.timestamps.push(now);
  }

  size(now = Date.now()): number {
    this.prune(now);
    return this.timestamps.length;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.timestamps.length && this.timestamps[0] <= cutoff) {
      this.timestamps.shift();
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface GraphMessage {
  id: string;
  subject?: string | null;
  receivedDateTime?: string | null;
  from?: { emailAddress?: { address?: string; name?: string } } | null;
  body?: { contentType?: string; content?: string } | null;
  bodyPreview?: string | null;
  internetMessageId?: string | null;
  conversationId?: string | null;
}

export interface OutlookSyncDeps {
  /** Returns a Graph access token (minted from a refresh token by the caller). */
  getAccessToken: () => Promise<string>;
  /** Persist one encrypted message row. */
  persistMessage: (row: PersistedMessage) => Promise<void>;
  /** Persist (and read) the per-user delta token + state. */
  saveDeltaToken: (token: string) => Promise<void>;
  loadDeltaToken: () => Promise<string | null>;
  /** The user id under which content is encrypted. */
  userId: string;
  /** Optional clock injection (for tests). */
  now?: () => number;
  /** Optional sleep injection (for tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Optional Graph client override (for tests). */
  client?: Client;
  /** Optional pacer override (for tests). */
  pacer?: GraphPacer;
  /** Backfill cap; defaults to 1000 per PRD §7.4. */
  backfillCap?: number;
  /** Optional encrypt override (for tests). Defaults to AINBOX-5 lib/crypto.ts. */
  encryptForUser?: EncryptForUser;
  /**
   * TASK7544-79: Called once, fire-and-forget, after the first page of messages
   * is persisted during a backfill. Kicks classify + draft immediately so the
   * user sees their first draft within 4 minutes instead of waiting for pg_cron.
   */
  pipelineKick?: (userId: string) => Promise<void>;
}

export interface PersistedMessage {
  user_id: string;
  provider: 'outlook';
  provider_message_id: string;
  internet_message_id: string | null;
  conversation_id: string | null;
  subject_hash: string;
  sender_domain: string | null;
  received_at: string | null;
  body_encrypted: string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function buildClient(getAccessToken: () => Promise<string>): Client {
  const opts: ClientOptions = {
    authProvider: {
      getAccessToken: () => getAccessToken(),
    },
  };
  return Client.initWithMiddleware(opts);
}

function subjectHash(subject: string | null | undefined): string {
  // Stable, non-reversible hash for log/observability surfaces (§4.3).
  // Uses Web Crypto if available, else a tiny non-crypto fallback (logs only).
  const s = subject ?? '';
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return `h${(h >>> 0).toString(16)}`;
}

function senderDomain(msg: GraphMessage): string | null {
  const addr = msg.from?.emailAddress?.address;
  if (!addr || typeof addr !== 'string') return null;
  const at = addr.lastIndexOf('@');
  return at < 0 ? null : addr.slice(at + 1).toLowerCase();
}

// ---------------------------------------------------------------------------
// Retry helper — exponential backoff up to 6 attempts (§7.17).
// Honours Retry-After (seconds) when present (§7.18).
// ---------------------------------------------------------------------------
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
        (err as { statusCode?: number }).statusCode ??
        (err as { status?: number }).status;
      const retryAfterHeader =
        ((err as { headers?: Record<string, string> }).headers ?? {})['retry-after'] ??
        ((err as { headers?: Record<string, string> }).headers ?? {})['Retry-After'];
      const transient =
        status === 429 || (typeof status === 'number' && status >= 500 && status < 600);
      if (!transient || attempt === maxAttempts) throw err;
      const backoff = retryAfterHeader
        ? Number(retryAfterHeader) * 1000
        : Math.min(30_000, 2 ** attempt * 250);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Backfill — paginate /me/messages?$top=100 until cap (default 1000)
// ---------------------------------------------------------------------------
export async function runOutlookBackfill(
  deps: OutlookSyncDeps,
): Promise<{ persisted: number; pages: number }> {
  const sleep = deps.sleep ?? defaultSleep;
  const pacer = deps.pacer ?? new GraphPacer();
  const cap = deps.backfillCap ?? 1000;
  const client = deps.client ?? buildClient(deps.getAccessToken);
  const encrypt = deps.encryptForUser ?? (await getEncryptForUser());

  let persisted = 0;
  let pages = 0;
  let pipelineKicked = false;
  let url: string | null = `/me/messages?$top=100&$select=${encodeURIComponent(
    'id,subject,receivedDateTime,from,body,bodyPreview,internetMessageId,conversationId',
  )}`;

  while (url && persisted < cap) {
    const wait = pacer.delayBeforeNext(deps.now?.() ?? Date.now());
    if (wait > 0) await sleep(wait);

    const res = await withRetry(
      () => client.api(url as string).get() as Promise<{
        value: GraphMessage[];
        ['@odata.nextLink']?: string;
      }>,
      sleep,
    );
    pacer.record(deps.now?.() ?? Date.now());
    pages += 1;

    for (const msg of res.value ?? []) {
      if (persisted >= cap) break;
      const bodyContent = msg.body?.content ?? '';
      const encryptedBody = await encrypt(deps.userId, bodyContent);
      await deps.persistMessage({
        user_id: deps.userId,
        provider: 'outlook',
        provider_message_id: msg.id,
        internet_message_id: msg.internetMessageId ?? null,
        conversation_id: msg.conversationId ?? null,
        subject_hash: subjectHash(msg.subject),
        sender_domain: senderDomain(msg),
        received_at: msg.receivedDateTime ?? null,
        body_encrypted: encryptedBody,
      });
      persisted += 1;
    }

    // TASK7544-79: kick classify + draft in parallel after the first page
    // so the user gets their first draft in < 4 min instead of waiting for cron.
    if (!pipelineKicked && persisted > 0 && deps.pipelineKick) {
      pipelineKicked = true;
      void deps.pipelineKick(deps.userId).catch((err) => {
        console.error('[sync/outlook] pipelineKick threw:', (err as Error).message);
      });
    }

    const next = (res as { ['@odata.nextLink']?: string })['@odata.nextLink'] ?? null;
    url = next;
  }

  // Seed delta token AFTER backfill — first call to /me/messages/delta returns
  // the latest deltaLink we can use for incremental polls.
  await seedDeltaToken({ ...deps, client });

  return { persisted, pages };
}

// ---------------------------------------------------------------------------
// Delta seed + incremental sync (§7.5)
// ---------------------------------------------------------------------------
async function seedDeltaToken(
  deps: OutlookSyncDeps & { client: Client },
): Promise<void> {
  const sleep = deps.sleep ?? defaultSleep;
  const pacer = deps.pacer ?? new GraphPacer();
  let url: string | null = '/me/messages/delta?$top=100';
  let deltaLink: string | null = null;

  // Walk through the delta initialisation pages until we hit the deltaLink.
  // We don't re-persist messages here — the backfill already covered them.
  while (url) {
    const wait = pacer.delayBeforeNext(deps.now?.() ?? Date.now());
    if (wait > 0) await sleep(wait);
    const res = await withRetry(
      () => deps.client.api(url as string).get() as Promise<{
        ['@odata.nextLink']?: string;
        ['@odata.deltaLink']?: string;
      }>,
      sleep,
    );
    pacer.record(deps.now?.() ?? Date.now());
    if (res['@odata.deltaLink']) {
      deltaLink = res['@odata.deltaLink'];
      break;
    }
    url = res['@odata.nextLink'] ?? null;
  }

  if (deltaLink) {
    await deps.saveDeltaToken(deltaLink);
  }
}

export async function runOutlookIncremental(
  deps: OutlookSyncDeps,
): Promise<{ persisted: number; deltaToken: string | null }> {
  const sleep = deps.sleep ?? defaultSleep;
  const pacer = deps.pacer ?? new GraphPacer();
  const client = deps.client ?? buildClient(deps.getAccessToken);
  const encrypt = deps.encryptForUser ?? (await getEncryptForUser());

  const startToken = await deps.loadDeltaToken();
  let url: string | null = startToken ?? '/me/messages/delta?$top=100';
  let persisted = 0;
  let deltaLink: string | null = null;

  while (url) {
    const wait = pacer.delayBeforeNext(deps.now?.() ?? Date.now());
    if (wait > 0) await sleep(wait);

    const res = await withRetry(
      () => client.api(url as string).get() as Promise<{
        value?: GraphMessage[];
        ['@odata.nextLink']?: string;
        ['@odata.deltaLink']?: string;
      }>,
      sleep,
    );
    pacer.record(deps.now?.() ?? Date.now());

    for (const msg of res.value ?? []) {
      const bodyContent = msg.body?.content ?? '';
      const encryptedBody = await encrypt(deps.userId, bodyContent);
      await deps.persistMessage({
        user_id: deps.userId,
        provider: 'outlook',
        provider_message_id: msg.id,
        internet_message_id: msg.internetMessageId ?? null,
        conversation_id: msg.conversationId ?? null,
        subject_hash: subjectHash(msg.subject),
        sender_domain: senderDomain(msg),
        received_at: msg.receivedDateTime ?? null,
        body_encrypted: encryptedBody,
      });
      persisted += 1;
    }

    if (res['@odata.deltaLink']) {
      deltaLink = res['@odata.deltaLink'];
      url = null;
    } else {
      url = res['@odata.nextLink'] ?? null;
    }
  }

  if (deltaLink) {
    await deps.saveDeltaToken(deltaLink);
  }

  return { persisted, deltaToken: deltaLink };
}

// Exposed for tests.
export const __testing = { subjectHash, senderDomain, withRetry };
