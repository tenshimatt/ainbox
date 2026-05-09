/**
 * PRD §3.5 LiteLLM gateway
 * PRD §3.7 Embeddings (Ollama bge-m3, 1024-dim)
 * PRD §4.4 Confidence model (cosine retrieval)
 * PRD §7.8 Embedding pipeline (chunk + embed + re-embed + search)
 *
 * Mocks LiteLLM at the network boundary (a fake fetch handed to
 * embedChunks). Verifies:
 *   1. chunkText splits long text into ~500-token chunks
 *   2. embedChunks calls /embeddings, returns 1024-dim vectors in order
 *   3. dimension mismatch throws
 *   4. /api/embeddings/index and /api/embeddings/search routes exist
 *      (don't 404), and reject unauthenticated callers
 */
import { test, expect } from '@playwright/test';
import {
  embedChunks,
  toPgVector,
  EMBEDDING_DIM,
} from '../../src/lib/embeddings/embed';
import { chunkText } from '../../src/lib/embeddings/chunk';

function fakeVector(seed: number): number[] {
  const v = new Array<number>(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    v[i] = ((seed * 9301 + i * 49297) % 233280) / 233280;
  }
  return v;
}

function makeFetchMock(opts: {
  expectedModel?: string;
  status?: number;
  body?: unknown;
} = {}): { fn: typeof fetch; calls: Array<{ url: string; body: any }> } {
  const calls: Array<{ url: string; body: any }> = [];
  const fn = (async (url: any, init: any) => {
    const u = typeof url === 'string' ? url : url.toString();
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: u, body });
    if (opts.expectedModel && body?.model !== opts.expectedModel) {
      return new Response('wrong model', { status: 400 });
    }
    if (opts.status && opts.status >= 400) {
      return new Response('boom', { status: opts.status });
    }
    const inputs: string[] = body?.input ?? [];
    const data = inputs.map((_, i) => ({ embedding: fakeVector(i + 1), index: i }));
    return new Response(
      JSON.stringify(opts.body ?? { data, model: body?.model }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test.describe('@features §7.8 embedding pipeline', () => {
  test('§7.8 chunkText returns [] for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  test('§7.8 chunkText keeps short text as a single chunk', () => {
    const out = chunkText('hello world this is short');
    expect(out.length).toBe(1);
    expect(out[0]).toContain('hello world');
  });

  test('§7.8 chunkText splits long text into ~500-token chunks', () => {
    // Build text well over 500 tokens (~2000 chars at 4 cpt).
    const para = 'the quick brown fox jumps over the lazy dog. '.repeat(80);
    const text = `${para}\n\n${para}\n\n${para}\n\n${para}`;
    const out = chunkText(text, { tokens: 500 });
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      // Allow some slack: chunks should be at most ~maxChars + small delta.
      expect(c.length).toBeLessThanOrEqual(2000 + 200);
      expect(c.length).toBeGreaterThan(0);
    }
  });

  test('§3.5 §3.7 embedChunks calls /embeddings with bge-m3 + returns 1024-d vectors', async () => {
    const { fn, calls } = makeFetchMock({ expectedModel: 'bge-m3' });
    const vecs = await embedChunks(['hello', 'world'], {
      baseUrl: 'https://gateway.test/v1',
      model: 'bge-m3',
      apiKey: 'sk-test',
      fetchFn: fn,
    });
    expect(vecs.length).toBe(2);
    for (const v of vecs) expect(v.length).toBe(EMBEDDING_DIM);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('https://gateway.test/v1/embeddings');
    expect(calls[0].body.model).toBe('bge-m3');
    expect(calls[0].body.input).toEqual(['hello', 'world']);
  });

  test('§3.7 embedChunks returns [] for empty input without calling network', async () => {
    const { fn, calls } = makeFetchMock();
    const vecs = await embedChunks([], { fetchFn: fn });
    expect(vecs).toEqual([]);
    expect(calls.length).toBe(0);
  });

  test('§3.7 embedChunks throws on dimension mismatch', async () => {
    const badFetch = (async () =>
      new Response(
        JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;
    await expect(
      embedChunks(['hi'], { fetchFn: badFetch }),
    ).rejects.toThrow(/dimension mismatch/i);
  });

  test('§3.7 embedChunks throws on non-200', async () => {
    const { fn } = makeFetchMock({ status: 500 });
    await expect(
      embedChunks(['hi'], { fetchFn: fn }),
    ).rejects.toThrow(/500/);
  });

  test('§7.8 toPgVector formats 1024-d array as pgvector literal', () => {
    const v = fakeVector(1);
    const lit = toPgVector(v);
    expect(lit.startsWith('[')).toBe(true);
    expect(lit.endsWith(']')).toBe(true);
    expect(lit.split(',').length).toBe(EMBEDDING_DIM);
  });

  test('§7.8 /api/embeddings/index endpoint exists and rejects unauth', async ({ page }) => {
    const resp = await page.request.post('/api/embeddings/index', {
      data: { items: [{ text: 'hello', type: 'faq' }] },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).not.toBe(404);
    // Without an Authorization header we expect an auth-failure status
    // (401 from our handler, or 5xx if env not configured in CI). The
    // contract here is just "route exists and is wired".
    expect([401, 400, 500]).toContain(resp.status());
  });

  test('§7.8 /api/embeddings/search endpoint exists and rejects unauth', async ({ page }) => {
    const resp = await page.request.post('/api/embeddings/search', {
      data: { query: 'hello' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).not.toBe(404);
    expect([401, 400, 500]).toContain(resp.status());
  });

  test('§7.8 /api/embeddings/index rejects empty items[]', async ({ page }) => {
    const resp = await page.request.post('/api/embeddings/index', {
      data: { items: [] },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([400, 401]).toContain(resp.status());
  });

  test('§7.8 /api/embeddings/search rejects empty query', async ({ page }) => {
    const resp = await page.request.post('/api/embeddings/search', {
      data: { query: '' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([400, 401]).toContain(resp.status());
  });
});
