/**
 * PRD §3.5 LiteLLM gateway
 * PRD §3.7 Embeddings (Ollama bge-m3, 1024-dim)
 * PRD §7.8 Embedding pipeline
 *
 * Embeds text chunks via the LiteLLM gateway, which routes embedding
 * requests to the local Ollama bge-m3 model. The dimensionality is
 * locked at 1024 to match the pgvector column in `kb_items.embedding`.
 *
 * Environment:
 *  - LITELLM_BASE_URL          (default: https://ai-gateway.beyondpandora.com/v1)
 *  - LITELLM_EMBEDDING_MODEL   (default: bge-m3)
 *  - LITELLM_API_KEY           (virtual key; required at runtime, optional in tests)
 *
 * Failure modes:
 *  - empty input array → returns []
 *  - non-200 response → throws Error with status + body
 *  - missing/incorrect-dim vectors → throws Error
 */

export const EMBEDDING_DIM = 1024;

export interface EmbedOptions {
  /** Override base URL (mostly for tests). */
  baseUrl?: string;
  /** Override model name. */
  model?: string;
  /** Virtual API key. */
  apiKey?: string;
  /** Custom fetch (for tests). */
  fetchFn?: typeof fetch;
  /** Per-request timeout ms (default 30s). */
  timeoutMs?: number;
}

export async function embedChunks(
  texts: string[],
  opts: EmbedOptions = {},
): Promise<number[][]> {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const baseUrl =
    opts.baseUrl ??
    process.env.LITELLM_BASE_URL ??
    'https://ai-gateway.beyondpandora.com/v1';
  const model =
    opts.model ?? process.env.LITELLM_EMBEDDING_MODEL ?? 'bge-m3';
  const apiKey = opts.apiKey ?? process.env.LITELLM_API_KEY ?? '';
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  // Filter out empty strings; the gateway/Ollama will 400 on them.
  const cleaned = texts.map((t) => (typeof t === 'string' ? t : '')).filter(
    (t) => t.trim().length > 0,
  );
  if (cleaned.length === 0) return [];

  const url = `${baseUrl.replace(/\/$/, '')}/embeddings`;
  const ctrl = new AbortController();
  const tt = setTimeout(() => ctrl.abort(), timeoutMs);

  let resp: Response;
  try {
    resp = await fetchFn(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, input: cleaned }),
    });
  } finally {
    clearTimeout(tt);
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '<no body>');
    throw new Error(
      `LiteLLM /embeddings ${resp.status} ${resp.statusText}: ${body.slice(0, 500)}`,
    );
  }

  const json = (await resp.json()) as {
    data?: Array<{ embedding: number[]; index?: number }>;
  };
  const data = json.data ?? [];
  if (data.length !== cleaned.length) {
    throw new Error(
      `LiteLLM /embeddings returned ${data.length} vectors for ${cleaned.length} inputs`,
    );
  }

  // Sort by index when present so output order matches input order.
  data.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  const vectors = data.map((d) => d.embedding);
  for (const v of vectors) {
    if (!Array.isArray(v) || v.length !== EMBEDDING_DIM) {
      throw new Error(
        `Embedding dimension mismatch: expected ${EMBEDDING_DIM}, got ${
          Array.isArray(v) ? v.length : typeof v
        }`,
      );
    }
  }
  return vectors;
}

/**
 * Format a number[] as a pgvector literal: '[0.1,0.2,...]'.
 * Use when binding via raw SQL; supabase-js JSON path is also acceptable
 * for the `vector` column when cast at the DB.
 */
export function toPgVector(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
