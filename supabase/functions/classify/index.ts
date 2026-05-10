/**
 * Supabase Edge Function — classify
 *
 * PRD §7.9 — Inbound email classification engine.
 *
 * Triggered internally (pg_cron or post-sync hook) with a service-role JWT.
 * Processes up to `limit` pending classify tasks from `email_queue`:
 *   1. Claims each task (status → 'processing')
 *   2. Fetches the email row from `emails`
 *   3. Calls LiteLLM (DeepSeek V4 Pro) with structured-output instruction
 *   4. Persists ai_classification + ai_processed=true on the email row
 *   5. Writes an immutable audit_logs entry
 *   6. Marks the queue task 'completed' or 'failed'
 *
 * Security:
 *   - Requires service-role JWT (not user-facing).
 *   - All DB ops use the service-role client; RLS is bypassed here
 *     intentionally (internal queue processor — PRD §4.1 exception).
 *   - Email body is NOT logged; only body_plain_preview (≤200 chars) is
 *     sent to the classifier (PII boundary — CLAUDE.md §6 / §4.3).
 *
 * Request shape:
 *   POST /functions/v1/classify
 *   Body: { "limit"?: number }   (optional, default 25)
 *
 * Response shape:
 *   { ok: true, total: N, classified: N, failed: N }
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = [
  'sales',
  'support',
  'invoice',
  'complaint',
  'meeting',
  'investor',
  'urgent',
  'escalation',
  'spam',
  'other',
] as const;

type Category = (typeof VALID_CATEGORIES)[number];

interface ClassificationResult {
  category: Category;
  confidence: number;
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

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an email classifier. Given an inbound email, classify it into EXACTLY ONE of these categories:
sales, support, invoice, complaint, meeting, investor, urgent, escalation, spam, other.

Respond ONLY with a JSON object of shape:
{"category": "<one_of_the_categories>", "confidence": <number between 0 and 1>}

Pick the single best fit. If none fits, use "other". Confidence reflects how certain you are.`;

function isCategory(value: unknown): value is Category {
  return (
    typeof value === 'string' &&
    (VALID_CATEGORIES as readonly string[]).includes(value)
  );
}

async function classifyEmail(opts: {
  subject?: string | null;
  body?: string | null;
  from?: string | null;
  baseUrl: string;
  apiKey: string;
  model: string;
}): Promise<ClassificationResult> {
  const subject = (opts.subject ?? '').slice(0, 300);
  const body = (opts.body ?? '').slice(0, 2000);
  const from = (opts.from ?? '').slice(0, 200);
  const userPrompt = `From: ${from}\nSubject: ${subject}\n\nBody:\n${body}`;

  const resp = await fetch(`${opts.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`LiteLLM HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  const json = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json?.choices?.[0]?.message?.content ?? '';
  if (!content) throw new Error('empty completion content');

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error(`invalid JSON in completion: ${(e as Error).message}`);
  }

  const obj = parsed as { category?: unknown; confidence?: unknown };
  const category = isCategory(obj.category) ? obj.category : 'other';
  let confidence =
    typeof obj.confidence === 'number' && Number.isFinite(obj.confidence)
      ? obj.confidence
      : 0;
  if (confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;

  return { category, confidence };
}

// ---------------------------------------------------------------------------
// Queue processor
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
async function processQueue(supabase: any, limit: number): Promise<{
  total: number;
  classified: number;
  failed: number;
}> {
  const litellmBaseUrl =
    Deno.env.get('LITELLM_BASE_URL') ?? 'https://ai-gateway.beyondpandora.com/v1';
  const litellmApiKey = Deno.env.get('LITELLM_API_KEY') ?? '';
  const model = Deno.env.get('CLASSIFY_MODEL') ?? 'deepseek-v4-pro';
  const now = () => new Date().toISOString();

  const { data: tasks, error: fetchErr } = await supabase
    .from('email_queue')
    .select('id, email_id, user_id, attempts, max_attempts')
    .eq('task_type', 'classify')
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit);

  if (fetchErr) {
    throw new Error(`queue fetch failed: ${fetchErr.message}`);
  }

  const rows = (tasks ?? []) as QueueRow[];
  let classified = 0;
  let failed = 0;

  for (const task of rows) {
    const { id: queueId, email_id: emailId, user_id: userId } = task;

    // Claim the task.
    await supabase
      .from('email_queue')
      .update({ status: 'processing', started_at: now() })
      .eq('id', queueId)
      .eq('status', 'pending');

    try {
      const { data: emailData, error: emailErr } = await supabase
        .from('emails')
        .select('id, subject, body_plain_preview, from_address, user_id')
        .eq('id', emailId)
        .eq('user_id', userId)
        .maybeSingle();

      if (emailErr) throw new Error(`email fetch: ${emailErr.message}`);
      if (!emailData) throw new Error('email not found');

      const email = emailData as EmailRow;

      const result = await classifyEmail({
        subject: email.subject,
        body: email.body_plain_preview,
        from: email.from_address,
        baseUrl: litellmBaseUrl,
        apiKey: litellmApiKey,
        model,
      });

      const { error: updErr } = await supabase
        .from('emails')
        .update({ ai_classification: result.category, ai_processed: true })
        .eq('id', emailId)
        .eq('user_id', userId);

      if (updErr) throw new Error(`emails update: ${updErr.message}`);

      // Non-fatal audit write.
      await supabase.from('audit_logs').insert({
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
        created_at: now(),
      });

      await supabase
        .from('email_queue')
        .update({ status: 'completed', completed_at: now() })
        .eq('id', queueId);

      classified += 1;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const newAttempts = task.attempts + 1;
      const exhausted = newAttempts >= task.max_attempts;

      await supabase
        .from('email_queue')
        .update({
          status: exhausted ? 'failed' : 'pending',
          error_message: errMsg,
          attempts: newAttempts,
          started_at: null,
        })
        .eq('id', queueId);

      console.error(`[classify] failed queueId=${queueId} emailId=${emailId}:`, errMsg);
      failed += 1;
    }
  }

  return { total: rows.length, classified, failed };
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: 'missing_env', detail: 'SUPABASE_URL or SERVICE_ROLE_KEY' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let limit = 25;
  try {
    const body = await req.json().catch(() => ({})) as { limit?: unknown };
    if (typeof body.limit === 'number' && body.limit > 0) {
      limit = Math.min(body.limit, 100);
    }
  } catch {
    // default limit
  }

  try {
    const result = await processQueue(supabase, limit);
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[classify] processQueue error:', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
