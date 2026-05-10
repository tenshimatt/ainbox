/**
 * PRD §7.9 — Queue-aware classification processor.
 *
 * Reads pending `classify` tasks from `email_queue`, claims each task,
 * runs the LiteLLM classifier, writes the result to `emails`, and logs
 * to `audit_logs`. Marks each task `completed` on success or increments
 * `attempts` (up to `max_attempts`) on failure.
 *
 * Designed to be called from the Supabase Edge Function (service-role)
 * and testable in Node.js via a FakeStore that mirrors SupabaseClient.
 *
 * Email PII boundary: only `body_plain_preview` (first 200 chars) is
 * sent to the classifier — full body is never loaded here.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyEmail, type ClassificationResult, type EmailToClassify } from './classify';

export interface QueueBatchResult {
  total: number;
  classified: number;
  failed: number;
  results: Array<
    | { queueId: string; emailId: string; ok: true; result: ClassificationResult }
    | { queueId: string; emailId: string; ok: false; error: string }
  >;
}

export interface QueueBatchOptions {
  /** Inject a custom classifier (useful in tests). */
  classifier?: (email: EmailToClassify) => Promise<ClassificationResult>;
  /** Inject a clock (useful in tests for deterministic timestamps). */
  now?: () => Date;
}

interface QueueRow {
  id: string;
  email_id: string;
  user_id: string;
  attempts: number;
  max_attempts: number;
}

interface EmailRow {
  id: string;
  subject: string | null;
  body_plain_preview: string | null;
  from_address: string;
  user_id: string;
}

/**
 * Process up to `limit` pending classify queue tasks.
 *
 * Each task is claimed (status → `processing`) before the classifier
 * runs, so concurrent invocations of this function don't double-process
 * the same row.
 */
export async function processClassifyQueue(
  supabase: SupabaseClient,
  limit = 25,
  opts: QueueBatchOptions = {},
): Promise<QueueBatchResult> {
  const classifier = opts.classifier ?? classifyEmail;
  const now = opts.now ?? (() => new Date());

  // Fetch pending classify tasks, highest priority first.
  const { data: tasks, error: fetchErr } = await supabase
    .from('email_queue')
    .select('id, email_id, user_id, attempts, max_attempts')
    .eq('task_type', 'classify')
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit);

  if (fetchErr) {
    throw new Error(`processClassifyQueue: queue fetch failed: ${fetchErr.message}`);
  }

  const rows = (tasks ?? []) as QueueRow[];
  const out: QueueBatchResult = {
    total: rows.length,
    classified: 0,
    failed: 0,
    results: [],
  };

  for (const task of rows) {
    const { id: queueId, email_id: emailId, user_id: userId } = task;

    // Claim the task atomically — only succeeds if still `pending`.
    await supabase
      .from('email_queue')
      .update({ status: 'processing', started_at: now().toISOString() })
      .eq('id', queueId)
      .eq('status', 'pending');

    try {
      // Fetch the email. Only preview body is used (PII boundary).
      const { data: emailData, error: emailErr } = await supabase
        .from('emails')
        .select('id, subject, body_plain_preview, from_address, user_id')
        .eq('id', emailId)
        .eq('user_id', userId)
        .maybeSingle();

      if (emailErr) {
        throw new Error(`email fetch failed: ${emailErr.message}`);
      }
      if (!emailData) {
        throw new Error('email not found');
      }

      const email = emailData as EmailRow;

      const result = await classifier({
        id: email.id,
        subject: email.subject,
        body: email.body_plain_preview,
        from: email.from_address,
      });

      // Persist classification on the email row.
      const { error: updErr } = await supabase
        .from('emails')
        .update({
          ai_classification: result.category,
          ai_processed: true,
        })
        .eq('id', emailId)
        .eq('user_id', userId);

      if (updErr) {
        throw new Error(`emails update failed: ${updErr.message}`);
      }

      // Immutable audit entry — non-fatal on failure (logged, not thrown).
      const { error: auditErr } = await supabase.from('audit_logs').insert({
        user_id: userId,
        event_type: 'classification',
        entity_type: 'email',
        entity_id: emailId,
        action: 'classify',
        details: {
          category: result.category,
          confidence: result.confidence,
          queue_id: queueId,
        },
        created_at: now().toISOString(),
      });

      if (auditErr) {
        // Audit failure must not block the classification result.
        console.error('[classify-queue] audit_logs insert failed', auditErr.message);
      }

      // Mark queue task complete.
      await supabase
        .from('email_queue')
        .update({ status: 'completed', completed_at: now().toISOString() })
        .eq('id', queueId);

      out.classified += 1;
      out.results.push({ queueId, emailId, ok: true, result });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const newAttempts = task.attempts + 1;
      const exhausted = newAttempts >= task.max_attempts;

      // If retries remain, reset to `pending` so the next invocation picks
      // it up; otherwise flip to `failed` to stop retrying.
      await supabase
        .from('email_queue')
        .update({
          status: exhausted ? 'failed' : 'pending',
          error_message: errMsg,
          attempts: newAttempts,
          started_at: null,
        })
        .eq('id', queueId);

      out.failed += 1;
      out.results.push({ queueId, emailId, ok: false, error: errMsg });
    }
  }

  return out;
}
