/**
 * Reply drafting worker — TASKRESPONSE-10.
 *
 * PRD: §4.4 Confidence model
 *      §7.10 Reply drafting
 *
 * Inputs an inbound `email`, retrieves the top-5 KB items, builds a
 * context-rich prompt (KB + 3 sample sent emails for tone), calls
 * LiteLLM (`deepseek-v4-pro`) for a structured-output reply with a
 * self-rated `generation_score`, and returns:
 *   { body, retrieval_score, generation_score, confidence, kb_items_used }
 *
 * confidence = min(retrieval_score, generation_score)   // NOT average
 *
 * Note: thresholding (auto-send ≥ 0.85) is enforced downstream by
 * TASKRESPONSE-12. This worker only RECORDS the score.
 */

export interface InboundEmail {
  id: string;
  user_id: string;
  subject: string;
  /** Plaintext body — decrypted in caller, never logged. */
  body: string;
  from?: string;
  category?: string;
}

export interface KbHit {
  id: string;
  content: string;
  /** Cosine similarity in [0, 1]. */
  score: number;
}

export interface SampleSentEmail {
  subject: string;
  body: string;
}

export interface DraftResult {
  body: string;
  retrieval_score: number;
  generation_score: number;
  confidence: number;
  kb_items_used: string[];
}

export interface DraftDeps {
  /** TASKRESPONSE-7 KB embeddings search. */
  searchKb: (
    userId: string,
    query: string,
    topN: number,
  ) => Promise<KbHit[]>;
  /** Sample sent emails for tone-priming (PRD §7.10 — "3 sample sent emails"). */
  loadSampleSent: (userId: string, n: number) => Promise<SampleSentEmail[]>;
  /** LiteLLM structured-output call. Must return {body, generation_score}. */
  callLlm: (prompt: LlmPrompt) => Promise<{ body: string; generation_score: number }>;
}

export interface LlmPrompt {
  system: string;
  user: string;
  /** For structured-output / JSON-mode validation. */
  schema: {
    type: 'object';
    properties: { body: { type: 'string' }; generation_score: { type: 'number' } };
    required: ['body', 'generation_score'];
  };
  model: string;
}

const DRAFT_MODEL = 'deepseek-v4-pro';

const SYSTEM_PROMPT = `You are an email reply assistant. Use the provided
knowledge-base snippets as the source of truth. Match the tone of the
sample sent emails. Reply concisely. Never invent facts not in the KB.

Output JSON ONLY in the shape:
{ "body": string, "generation_score": number }

generation_score is YOUR self-rated confidence in [0,1] that the reply
is correct, on-tone, and answers the email. Be honest; under-rate when
the KB does not cover the question.`;

function buildUserPrompt(
  email: InboundEmail,
  kb: KbHit[],
  samples: SampleSentEmail[],
): string {
  const kbBlock = kb.length
    ? kb.map((k, i) => `[KB-${i + 1} score=${k.score.toFixed(3)}]\n${k.content}`).join('\n\n')
    : '(no KB items retrieved)';
  const sampleBlock = samples.length
    ? samples
        .map((s, i) => `[Sample-${i + 1}]\nSubject: ${s.subject}\n${s.body}`)
        .join('\n\n')
    : '(no sample sent emails)';
  return [
    '## Knowledge base (top-5 by cosine similarity)',
    kbBlock,
    '',
    '## Tone samples (recent sent emails)',
    sampleBlock,
    '',
    '## Inbound email to reply to',
    `Subject: ${email.subject}`,
    email.body,
  ].join('\n');
}

/**
 * Draft a reply to an inbound email.
 *
 * Pure function over its `deps` — caller injects the KB search, sample
 * loader, and LLM client. Tests stub these without a network.
 */
export async function draftReply(
  email: InboundEmail,
  deps: DraftDeps,
): Promise<DraftResult> {
  if (!email?.user_id) throw new Error('draftReply: email.user_id required');
  if (!email.body) throw new Error('draftReply: email.body required');

  const query = `${email.subject}\n${email.body}`;
  const [kbHits, samples] = await Promise.all([
    deps.searchKb(email.user_id, query, 5),
    deps.loadSampleSent(email.user_id, 3),
  ]);

  // retrieval_score = max cosine similarity from KB (PRD §4.4).
  const retrieval_score = kbHits.length
    ? Math.max(...kbHits.map((h) => h.score))
    : 0;

  const prompt: LlmPrompt = {
    model: DRAFT_MODEL,
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(email, kbHits, samples),
    schema: {
      type: 'object',
      properties: {
        body: { type: 'string' },
        generation_score: { type: 'number' },
      },
      required: ['body', 'generation_score'],
    },
  };

  const llmOut = await deps.callLlm(prompt);

  // Clamp scores into [0,1] defensively — LLM can return out-of-range.
  const generation_score = clamp01(llmOut.generation_score);
  const ret = clamp01(retrieval_score);

  // PRD §4.4: confidence = MIN of the two scores. NOT an average.
  const confidence = Math.min(ret, generation_score);

  return {
    body: llmOut.body,
    retrieval_score: ret,
    generation_score,
    confidence,
    kb_items_used: kbHits.map((h) => h.id),
  };
}

function clamp01(n: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Default LiteLLM caller. Used by the API route.
 * Tests inject their own callLlm and never reach this.
 */
export async function liteLlmCall(prompt: LlmPrompt): Promise<{
  body: string;
  generation_score: number;
}> {
  const baseUrl = process.env.LITELLM_BASE_URL;
  const apiKey = process.env.LITELLM_API_KEY ?? '';
  if (!baseUrl) throw new Error('LITELLM_BASE_URL not configured');

  const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: prompt.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`LiteLLM error: ${resp.status}`);
  const json = (await resp.json()) as {
    choices: { message: { content: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(content) as { body?: string; generation_score?: number };
  return {
    body: parsed.body ?? '',
    generation_score: typeof parsed.generation_score === 'number' ? parsed.generation_score : 0,
  };
}
