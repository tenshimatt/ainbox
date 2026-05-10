/**
 * AINBOX-16 — kb-extract edge function: batch helper
 * PRD: §4.4 §7.6 §7.7
 *
 * Fetches unprocessed emails for a user, runs KB extraction, persists
 * kb_items, and marks source emails with kb_extracted_at. Designed to be
 * called from both the Supabase edge function and tests (injectable deps).
 */

import { extractKbItems, type KbItem, type EmailMessage } from './extract';

// ---------------------------------------------------------------------------
// Minimal Supabase-client interface (injectable for testing)
// ---------------------------------------------------------------------------

type SelectChain = {
  eq(col: string, val: unknown): {
    is(col: string, val: unknown): {
      order(col: string, opts: { ascending: boolean }): {
        limit(n: number): Promise<{ data: unknown[] | null; error: unknown }>;
      };
    };
  };
};

type InsertChain = {
  select(cols: string): Promise<{ data: unknown[] | null; error: unknown }>;
};

type UpdateChain = {
  in(col: string, vals: unknown[]): {
    eq(col: string, val: unknown): Promise<{ error: unknown }>;
  };
};

export interface MinimalSupabaseForKbBatch {
  from(table: 'email_messages'): {
    select(cols: string): SelectChain;
    insert(rows: Record<string, unknown>[]): InsertChain;
    update(patch: Record<string, unknown>): UpdateChain;
  };
  from(table: 'kb_items'): {
    select(cols: string): SelectChain;
    insert(rows: Record<string, unknown>[]): InsertChain;
    update(patch: Record<string, unknown>): UpdateChain;
  };
  from(table: string): {
    select(cols: string): SelectChain;
    insert(rows: Record<string, unknown>[]): InsertChain;
    update(patch: Record<string, unknown>): UpdateChain;
  };
}

// ---------------------------------------------------------------------------
// Result + option types
// ---------------------------------------------------------------------------

export interface KbBatchResult {
  user_id: string;
  processed_emails: number;
  extracted: number;
  failed_batches: number;
  items: KbItem[];
}

export interface KbBatchOptions {
  /** Max emails to fetch (capped at 1 000). Defaults to 200. */
  limit?: number;
  /** Injectable clock — useful for deterministic tests. */
  now?: () => Date;
  /** Injectable extractor — defaults to `extractKbItems`. */
  extractor?: (
    userId: string,
    emails: EmailMessage[],
    opts?: Parameters<typeof extractKbItems>[2],
  ) => Promise<KbItem[]>;
  /** Options forwarded to the extractor (LiteLLM creds etc.). */
  extractorOpts?: Parameters<typeof extractKbItems>[2];
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function extractKbForUser(
  supabase: MinimalSupabaseForKbBatch,
  userId: string,
  opts: KbBatchOptions = {},
): Promise<KbBatchResult> {
  if (!userId) throw new Error('extractKbForUser: userId required');

  const limit = Math.min(opts.limit ?? 200, 1000);
  const now = opts.now ?? (() => new Date());
  const extractor = opts.extractor ?? extractKbItems;

  // ── 1. Fetch unprocessed emails ──────────────────────────────────────────
  const { data, error } = await supabase
    .from('email_messages')
    .select('id,subject,from_address,to_address,body,sent_at')
    .eq('user_id', userId)
    .is('kb_extracted_at', null)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`extractKbForUser: fetch failed: ${String(error)}`);
  }

  const emails = (data ?? []) as EmailMessage[];

  if (!emails.length) {
    return {
      user_id: userId,
      processed_emails: 0,
      extracted: 0,
      failed_batches: 0,
      items: [],
    };
  }

  // ── 2. Extract KB items (LiteLLM call inside extractor) ──────────────────
  const items = await extractor(userId, emails, opts.extractorOpts);

  let inserted: KbItem[] = items;
  let failedBatches = 0;

  if (items.length) {
    // ── 3. Persist to kb_items ─────────────────────────────────────────────
    const { data: ins, error: insErr } = await supabase
      .from('kb_items')
      .insert(items as unknown as Record<string, unknown>[])
      .select('*');

    if (insErr) {
      // Surface but don't abort — email marking still happens so we don't
      // re-process the same batch on the next run.
      console.error('[kb/batch] insert failed', insErr);
      failedBatches += 1;
    } else {
      inserted = (ins ?? items) as KbItem[];
    }

    // ── 4. Mark emails as processed (best-effort) ──────────────────────────
    const ids = Array.from(new Set(emails.map((e) => e.id)));
    if (ids.length) {
      await supabase
        .from('email_messages')
        .update({ kb_extracted_at: now().toISOString() })
        .in('id', ids)
        .eq('user_id', userId);
    }
  }

  return {
    user_id: userId,
    processed_emails: emails.length,
    extracted: failedBatches > 0 ? 0 : inserted.length,
    failed_batches: failedBatches,
    items: failedBatches > 0 ? [] : inserted,
  };
}
