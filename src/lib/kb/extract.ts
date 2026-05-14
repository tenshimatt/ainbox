/**
 * TASKRESPONSE-8 — Knowledge extraction over backfilled email corpus
 * PRD: §4.4 §7.6 §7.7
 *
 * Pulls typed KB items (faq | policy | pricing | preference | contact |
 * signature | tone-sample) out of an email corpus by batching emails
 * through the LiteLLM gateway. Returns typed, citation-bound items with
 * a confidence in [0,1]. Persistence + indexing is done by the caller
 * (see src/app/api/kb/extract/route.ts).
 */

export type KbItemType =
  | 'faq'
  | 'policy'
  | 'pricing'
  | 'preference'
  | 'contact'
  | 'signature'
  | 'tone-sample';

export const KB_ITEM_TYPES: readonly KbItemType[] = [
  'faq',
  'policy',
  'pricing',
  'preference',
  'contact',
  'signature',
  'tone-sample',
] as const;

export interface EmailMessage {
  id: string;
  user_id?: string;
  subject?: string | null;
  from_address?: string | null;
  to_address?: string | null;
  body?: string | null;
  sent_at?: string | null;
}

export interface KbItem {
  user_id: string;
  type: KbItemType;
  content: string;
  confidence: number;
  source_email_id: string;
  human_verified: boolean;
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

interface RawExtraction {
  type: string;
  content: string;
  confidence: number;
  source_email_id: string;
}

function isKbType(t: string): t is KbItemType {
  return (KB_ITEM_TYPES as readonly string[]).includes(t);
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function redact(body: string | null | undefined): string {
  if (!body) return '';
  // keep prompt tractable + drop trailing quote chains
  return body.slice(0, 4000);
}

function buildUserPrompt(batch: EmailMessage[]): string {
  const lines = batch.map((e) =>
    JSON.stringify({
      id: e.id,
      subject: e.subject ?? '',
      from: e.from_address ?? '',
      to: e.to_address ?? '',
      sent_at: e.sent_at ?? '',
      body: redact(e.body),
    }),
  );
  return `Emails (one JSON object per line):\n${lines.join('\n')}`;
}

function parseLlmJson(raw: string): RawExtraction[] {
  // tolerate code fences / leading prose
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
  systemPrompt: string,
  userPrompt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const resp = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`LiteLLM ${resp.status}: ${text.slice(0, 500)}`);
  }
  const json = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? '';
}

export interface ExtractKbItemsOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export async function extractKbItems(
  userId: string,
  emails: EmailMessage[],
  opts: ExtractKbItemsOptions = {},
): Promise<KbItem[]> {
  if (!userId) throw new Error('extractKbItems: userId required');
  if (!emails.length) return [];

  const baseUrl =
    opts.baseUrl ??
    process.env.LITELLM_BASE_URL ??
    'https://ai-gateway.beyondpandora.com/v1';
  const apiKey = opts.apiKey ?? process.env.LITELLM_API_KEY ?? '';
  const model = opts.model ?? process.env.LITELLM_MODEL ?? 'deepseek-v4-pro';
  const fetchImpl = opts.fetchImpl ?? fetch;

  if (!apiKey) throw new Error('extractKbItems: LITELLM_API_KEY missing');

  const validIds = new Set(emails.map((e) => e.id));
  const out: KbItem[] = [];

  for (const batch of chunk(emails, BATCH_SIZE)) {
    const userPrompt = buildUserPrompt(batch);
    let raw = '';
    try {
      raw = await callLiteLLM(baseUrl, apiKey, model, SYSTEM_PROMPT, userPrompt, fetchImpl);
    } catch (err) {
      // surface but don't kill the whole job
      console.error('[kb/extract] batch failed', err);
      continue;
    }
    for (const item of parseLlmJson(raw)) {
      if (!item || typeof item !== 'object') continue;
      if (!isKbType(item.type)) continue;
      if (typeof item.content !== 'string' || !item.content.trim()) continue;
      if (typeof item.source_email_id !== 'string' || !validIds.has(item.source_email_id)) continue;
      const confidence = Math.max(0, Math.min(1, Number(item.confidence)));
      if (!Number.isFinite(confidence)) continue;
      out.push({
        user_id: userId,
        type: item.type,
        content: item.content.trim(),
        confidence,
        source_email_id: item.source_email_id,
        human_verified: false,
      });
    }
  }

  return out;
}
