// @ts-nocheck — Deno edge function; uses URL imports not resolvable by tsc.
// AINBOX-16 — kb-extract edge function
// PRD: §4.4 §7.6 §7.7
//
// Background job: extract reusable knowledge items from unprocessed emails.
// Invoked by pg_cron or an internal webhook; NOT user-facing.
// Uses service-role key (acceptable for background jobs per CLAUDE.md).
//
// POST /functions/v1/kb-extract
// Headers:
//   Authorization: Bearer <service-role-key>   (internal cron)
//   OR
//   Authorization: Bearer <user-jwt>           (user-scoped run)
// Body (optional JSON):
//   { user_id?: string, limit?: number }
//
// When user_id is omitted the function processes ALL users that have
// emails with kb_extracted_at IS NULL (batch mode for cron jobs).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── KB item types ────────────────────────────────────────────────────────────

const KB_ITEM_TYPES = [
  'faq', 'policy', 'pricing', 'preference',
  'contact', 'signature', 'tone-sample',
] as const;
type KbItemType = typeof KB_ITEM_TYPES[number];

function isKbType(t: string): t is KbItemType {
  return (KB_ITEM_TYPES as readonly string[]).includes(t);
}

const BATCH_SIZE = 50;

const SYSTEM_PROMPT = `You extract reusable business knowledge from a user's email
history so an AI assistant can later draft replies in the user's voice.

Return ONLY a JSON array (no prose, no markdown fences) of typed knowledge items.
Each item MUST have these fields:
- "type": one of "faq" | "policy" | "pricing" | "preference" | "contact" | "signature" | "tone-sample"
- "content": a self-contained sentence/paragraph the assistant can re-use
- "confidence": a number in [0,1]; higher = clearer, more reusable
- "source_email_id": the id of the email this was extracted from (must appear in the input)

Only emit items that are durable facts or stylistic samples — skip one-off
chatter. If no items are extractable, return [].`;

interface EmailRow {
  id: string;
  subject?: string | null;
  from_address?: string | null;
  to_address?: string | null;
  body?: string | null;
  sent_at?: string | null;
}

interface RawExtraction {
  type: string;
  content: string;
  confidence: number;
  source_email_id: string;
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function redact(body: string | null | undefined): string {
  if (!body) return '';
  return body.slice(0, 4000);
}

function buildUserPrompt(batch: EmailRow[]): string {
  return `Emails (one JSON object per line):\n${batch
    .map((e) =>
      JSON.stringify({
        id: e.id,
        subject: e.subject ?? '',
        from: e.from_address ?? '',
        to: e.to_address ?? '',
        sent_at: e.sent_at ?? '',
        body: redact(e.body),
      }),
    )
    .join('\n')}`;
}

function parseLlmJson(raw: string): RawExtraction[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start < 0 || end < 0) return [];
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return Array.isArray(parsed) ? (parsed as RawExtraction[]) : [];
  } catch {
    return [];
  }
}

async function callLiteLLM(
  baseUrl: string,
  apiKey: string,
  model: string,
  userPrompt: string,
): Promise<string> {
  const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`LiteLLM ${resp.status}: ${text.slice(0, 500)}`);
  }
  const json = await resp.json() as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? '';
}

async function extractForUser(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  limit: number,
  litellmBase: string,
  litellmKey: string,
  litellmModel: string,
  now: string,
): Promise<{ processed_emails: number; extracted: number }> {
  // Fetch unprocessed emails
  const { data, error } = await supabase
    .from('email_messages')
    .select('id,subject,from_address,to_address,body,sent_at')
    .eq('user_id', userId)
    .is('kb_extracted_at', null)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[kb-extract] fetch emails failed for ${userId}:`, error);
    return { processed_emails: 0, extracted: 0 };
  }

  const emails = (data ?? []) as EmailRow[];
  if (!emails.length) return { processed_emails: 0, extracted: 0 };

  // Extract KB items in batches
  const validIds = new Set(emails.map((e) => e.id));
  const items: Array<{
    user_id: string;
    type: KbItemType;
    content: string;
    confidence: number;
    source_email_id: string;
    human_verified: boolean;
  }> = [];

  for (const batch of chunk(emails, BATCH_SIZE)) {
    let raw = '';
    try {
      raw = await callLiteLLM(
        litellmBase,
        litellmKey,
        litellmModel,
        buildUserPrompt(batch),
      );
    } catch (err) {
      console.error('[kb-extract] LiteLLM batch failed', err);
      continue;
    }
    for (const item of parseLlmJson(raw)) {
      if (!item || typeof item !== 'object') continue;
      if (!isKbType(item.type)) continue;
      if (typeof item.content !== 'string' || !item.content.trim()) continue;
      if (typeof item.source_email_id !== 'string' || !validIds.has(item.source_email_id)) continue;
      const confidence = Math.max(0, Math.min(1, Number(item.confidence)));
      if (!Number.isFinite(confidence)) continue;
      items.push({
        user_id: userId,
        type: item.type,
        content: item.content.trim(),
        confidence,
        source_email_id: item.source_email_id,
        human_verified: false,
      });
    }
  }

  // Persist
  if (items.length) {
    const { error: insErr } = await supabase.from('kb_items').insert(items);
    if (insErr) {
      console.error('[kb-extract] insert kb_items failed', insErr);
    }
  }

  // Mark emails processed (best-effort)
  const ids = Array.from(new Set(emails.map((e) => e.id)));
  await supabase
    .from('email_messages')
    .update({ kb_extracted_at: now })
    .in('id', ids)
    .eq('user_id', userId);

  return { processed_emails: emails.length, extracted: items.length };
}

// ── Request handler ──────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'method_not_allowed' }),
      { status: 405, headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  }

  const token = authHeader.slice(7);
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: 'misconfigured', detail: 'SUPABASE_URL or SERVICE_ROLE_KEY missing' }),
      { status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  }

  const litellmBase =
    Deno.env.get('LITELLM_BASE_URL') ?? 'https://ai-gateway.beyondpandora.com/v1';
  const litellmKey = Deno.env.get('LITELLM_API_KEY') ?? '';
  const litellmModel = Deno.env.get('LITELLM_MODEL') ?? 'deepseek-v4-pro';

  if (!litellmKey) {
    return new Response(
      JSON.stringify({ error: 'misconfigured', detail: 'LITELLM_API_KEY missing' }),
      { status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  }

  // Use service-role client — this is an internal background job, not user-facing.
  const supabase = createClient(supabaseUrl, serviceKey);

  // Verify caller identity (JWT decode or service-role equality)
  let targetUserId: string | null = null;
  if (token !== serviceKey) {
    // Treat as user JWT — verify and extract user_id
    const { data: userData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'unauthorized', detail: 'invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'content-type': 'application/json' } },
      );
    }
    targetUserId = userData.user.id;
  }

  let body: { user_id?: string; limit?: number } = {};
  try {
    body = await req.json();
  } catch { /* empty body is fine */ }

  const limit = Math.min(Math.max(body.limit ?? 200, 1), 1000);
  const now = new Date().toISOString();

  // If a specific user_id was passed in the body, it must match the JWT user
  // (service-role callers may pass any user_id for batch runs).
  const userId = targetUserId ?? body.user_id ?? null;

  if (userId) {
    // Single-user run
    const result = await extractForUser(
      supabase,
      userId,
      limit,
      litellmBase,
      litellmKey,
      litellmModel,
      now,
    );
    return new Response(
      JSON.stringify({ ok: true, users: 1, ...result }),
      { status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  }

  // Batch mode: process all users with pending emails
  const { data: userRows, error: userErr } = await supabase
    .from('email_messages')
    .select('user_id')
    .is('kb_extracted_at', null)
    .limit(500);

  if (userErr) {
    return new Response(
      JSON.stringify({ error: 'fetch_users_failed', detail: String(userErr) }),
      { status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  }

  const uniqueUserIds = [
    ...new Set((userRows ?? []).map((r: { user_id: string }) => r.user_id)),
  ];

  let totalProcessed = 0;
  let totalExtracted = 0;

  for (const uid of uniqueUserIds) {
    const r = await extractForUser(
      supabase,
      uid,
      limit,
      litellmBase,
      litellmKey,
      litellmModel,
      now,
    );
    totalProcessed += r.processed_emails;
    totalExtracted += r.extracted;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      users: uniqueUserIds.length,
      processed_emails: totalProcessed,
      extracted: totalExtracted,
    }),
    { status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' } },
  );
});
