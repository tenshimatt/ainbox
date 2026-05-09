/**
 * PRD §7.9 — Inbound email classification engine.
 *
 * Calls the LiteLLM gateway (DeepSeek V4 Pro) with a structured-output
 * instruction asking for a JSON object with `category` (one of the 10
 * permitted values) and `confidence` (0..1).
 *
 * Email PII boundary (factory-rules §8 / CLAUDE.md): the prompt sends
 * subject + a redacted body excerpt only; nothing is logged here.
 */

export const VALID_CATEGORIES = [
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

export type Category = (typeof VALID_CATEGORIES)[number];

export interface EmailToClassify {
  id?: string;
  subject?: string | null;
  body?: string | null;
  from?: string | null;
}

export interface ClassificationResult {
  category: Category;
  confidence: number;
}

const SYSTEM_PROMPT = `You are an email classifier. Given an inbound email, classify it into EXACTLY ONE of these categories:
sales, support, invoice, complaint, meeting, investor, urgent, escalation, spam, other.

Respond ONLY with a JSON object of shape:
{"category": "<one_of_the_categories>", "confidence": <number between 0 and 1>}

Pick the single best fit. If none fits, use "other". Confidence reflects how certain you are.`;

const DEFAULT_BASE_URL = 'https://ai-gateway.beyondpandora.com/v1';
const DEFAULT_MODEL = 'deepseek-v4-pro';

/**
 * Truncate a body excerpt for the prompt. Keep it short — the classifier
 * only needs the gist, not the entire thread.
 */
function buildUserPrompt(email: EmailToClassify): string {
  const subject = (email.subject ?? '').slice(0, 300);
  const body = (email.body ?? '').slice(0, 2000);
  const from = (email.from ?? '').slice(0, 200);
  return `From: ${from}\nSubject: ${subject}\n\nBody:\n${body}`;
}

function isCategory(value: unknown): value is Category {
  return (
    typeof value === 'string' &&
    (VALID_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * Classify a single email. Throws on transport / parse errors so the
 * caller (API route) can record a failure.
 */
export async function classifyEmail(
  email: EmailToClassify,
  opts: {
    fetchImpl?: typeof fetch;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  } = {},
): Promise<ClassificationResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const baseUrl = opts.baseUrl ?? process.env.LITELLM_BASE_URL ?? DEFAULT_BASE_URL;
  const apiKey = opts.apiKey ?? process.env.LITELLM_API_KEY ?? '';
  const model = opts.model ?? DEFAULT_MODEL;

  if (!fetchImpl) {
    throw new Error('classifyEmail: no fetch implementation available');
  }

  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(email) },
      ],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`classifyEmail: LiteLLM HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  const json = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json?.choices?.[0]?.message?.content ?? '';
  if (!content) {
    throw new Error('classifyEmail: empty completion content');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`classifyEmail: invalid JSON in completion: ${(err as Error).message}`);
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
