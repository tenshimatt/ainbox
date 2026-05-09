/**
 * PRD §7.9 — batch helper.
 *
 * Classify N pending unclassified emails for a user. Pulls rows where
 * `classified_at IS NULL`, runs `classifyEmail`, and updates the row.
 * Tenant isolation is enforced upstream — caller is expected to pass an
 * already-scoped Supabase client (RLS) AND the user_id (defence in depth).
 */

import { classifyEmail, type ClassificationResult, type EmailToClassify } from './classify';

export interface MinimalSupabaseLike {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        is: (col: string, val: unknown) => {
          limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }>;
        };
      };
    };
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: unknown) => Promise<{ error: unknown }>;
    };
    insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
  };
}

export interface BatchResult {
  total: number;
  classified: number;
  failed: number;
  results: Array<
    | { id: string; ok: true; result: ClassificationResult }
    | { id: string; ok: false; error: string }
  >;
}

export interface BatchOptions {
  classifier?: (email: EmailToClassify) => Promise<ClassificationResult>;
  now?: () => Date;
}

interface PendingRow {
  id: string;
  subject: string | null;
  body: string | null;
  from_address: string | null;
}

export async function classifyPendingForUser(
  supabase: MinimalSupabaseLike,
  userId: string,
  limit = 25,
  opts: BatchOptions = {},
): Promise<BatchResult> {
  const classifier = opts.classifier ?? classifyEmail;
  const now = opts.now ?? (() => new Date());

  const { data, error } = await supabase
    .from('email_messages')
    .select('id,subject,body,from_address')
    .eq('user_id', userId)
    .is('classified_at', null)
    .limit(limit);

  if (error) {
    throw new Error(`classifyPendingForUser: select failed: ${String(error)}`);
  }

  const rows = (data ?? []) as PendingRow[];
  const out: BatchResult = {
    total: rows.length,
    classified: 0,
    failed: 0,
    results: [],
  };

  for (const row of rows) {
    try {
      const result = await classifier({
        id: row.id,
        subject: row.subject,
        body: row.body,
        from: row.from_address,
      });

      const upd = await supabase
        .from('email_messages')
        .update({
          category: result.category,
          classified_at: now().toISOString(),
        })
        .eq('id', row.id);

      if (upd.error) {
        throw new Error(`update failed: ${String(upd.error)}`);
      }

      await supabase.from('audit_log').insert({
        user_id: userId,
        email_id: row.id,
        action: 'classify',
        category: result.category,
        confidence: result.confidence,
        created_at: now().toISOString(),
      });

      out.classified += 1;
      out.results.push({ id: row.id, ok: true, result });
    } catch (err) {
      out.failed += 1;
      out.results.push({
        id: row.id,
        ok: false,
        error: (err as Error).message ?? 'unknown',
      });
    }
  }

  return out;
}
