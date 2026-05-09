/**
 * AINBOX-10 — Reply drafting + confidence scoring
 *
 * PRD: §4.4 Confidence model
 *      §7.10 Reply drafting
 *
 * Unit-level Playwright spec (no browser). Verifies the pure
 * `draftReply()` worker:
 *   - retrieves top-5 KB items
 *   - calls the LLM (mocked)
 *   - computes confidence = min(retrieval_score, generation_score)
 *   - returns kb_items_used populated
 *
 * No real email content used in fixtures (factory-rules §8 / PRD §9.3).
 */

import { test, expect } from '@playwright/test';
import {
  draftReply,
  type DraftDeps,
  type InboundEmail,
  type KbHit,
} from '../../src/lib/draft/draft';
import { createProviderDraft } from '../../src/lib/sync/draft';

// ---- synthesised fixtures (no real PII) ----
const FIXTURE_EMAIL: InboundEmail = {
  id: 'email-fixture-001',
  user_id: 'user-fixture-001',
  subject: 'Synthetic question about widget pricing',
  body: 'This is a fully synthesised inbound message used only in tests.',
  from: 'sender at synthetic dot test',
};

const FIXTURE_KB: KbHit[] = [
  { id: 'kb-1', content: 'Widget A costs 10 fictional credits.', score: 0.92 },
  { id: 'kb-2', content: 'Widget B costs 20 fictional credits.', score: 0.81 },
  { id: 'kb-3', content: 'Bulk discount: 10% off above 50 units.', score: 0.74 },
  { id: 'kb-4', content: 'Shipping is free over 100 credits.', score: 0.61 },
  { id: 'kb-5', content: 'Returns accepted within 30 days.', score: 0.55 },
];

interface SearchKbCall {
  userId: string;
  query: string;
  topN: number;
}

function makeDeps(opts: {
  kb?: KbHit[];
  generationScore: number;
  body?: string;
  searchCalls?: SearchKbCall[];
  llmCalls?: unknown[];
}): DraftDeps {
  return {
    searchKb: async (userId, query, topN) => {
      opts.searchCalls?.push({ userId, query, topN });
      return opts.kb ?? FIXTURE_KB;
    },
    loadSampleSent: async () => [
      { subject: 'Re: synthetic prior thread', body: 'Thanks — confirmed.' },
      { subject: 'Re: another synthetic thread', body: 'Will follow up tomorrow.' },
      { subject: 'Re: third synthetic thread', body: 'Sounds good.' },
    ],
    callLlm: async (prompt) => {
      opts.llmCalls?.push(prompt);
      return {
        body: opts.body ?? 'Synthetic draft reply body.',
        generation_score: opts.generationScore,
      };
    },
  };
}

test.describe('@feature AINBOX-10 reply drafting', () => {
  test('§7.10 draftReply returns body, scores, and kb_items_used', async () => {
    const calls: SearchKbCall[] = [];
    const deps = makeDeps({ generationScore: 0.7, searchCalls: calls });

    const result = await draftReply(FIXTURE_EMAIL, deps);

    expect(result.body).toBeTruthy();
    expect(typeof result.body).toBe('string');
    expect(result.kb_items_used).toEqual([
      'kb-1',
      'kb-2',
      'kb-3',
      'kb-4',
      'kb-5',
    ]);
    // searchKb called with topN=5 per PRD §7.10
    expect(calls).toHaveLength(1);
    expect(calls[0].topN).toBe(5);
    expect(calls[0].userId).toBe(FIXTURE_EMAIL.user_id);
  });

  test('§4.4 confidence = MIN of retrieval_score and generation_score (not avg)', async () => {
    // retrieval_score = max KB score = 0.92; generation_score = 0.40
    const deps = makeDeps({ generationScore: 0.4 });
    const result = await draftReply(FIXTURE_EMAIL, deps);

    expect(result.retrieval_score).toBeCloseTo(0.92, 5);
    expect(result.generation_score).toBeCloseTo(0.4, 5);
    expect(result.confidence).toBeCloseTo(0.4, 5);
    // Sanity: confidence is NOT the average.
    const avg = (0.92 + 0.4) / 2;
    expect(result.confidence).not.toBeCloseTo(avg, 3);
  });

  test('§4.4 confidence uses retrieval_score when it is the smaller of the two', async () => {
    const lowKb: KbHit[] = [{ id: 'kb-only', content: 'sparse', score: 0.3 }];
    const deps = makeDeps({ kb: lowKb, generationScore: 0.95 });
    const result = await draftReply(FIXTURE_EMAIL, deps);

    expect(result.retrieval_score).toBeCloseTo(0.3, 5);
    expect(result.generation_score).toBeCloseTo(0.95, 5);
    expect(result.confidence).toBeCloseTo(0.3, 5);
  });

  test('§4.4 retrieval_score is 0 when KB is empty', async () => {
    const deps = makeDeps({ kb: [], generationScore: 0.9 });
    const result = await draftReply(FIXTURE_EMAIL, deps);

    expect(result.retrieval_score).toBe(0);
    expect(result.confidence).toBe(0); // min(0, 0.9)
    expect(result.kb_items_used).toEqual([]);
  });

  test('§4.4 confidence is clamped to [0,1] when LLM returns out-of-range', async () => {
    const overshoot = makeDeps({ generationScore: 1.7 });
    const r1 = await draftReply(FIXTURE_EMAIL, overshoot);
    expect(r1.generation_score).toBeLessThanOrEqual(1);

    const undershoot = makeDeps({ generationScore: -0.5 });
    const r2 = await draftReply(FIXTURE_EMAIL, undershoot);
    expect(r2.generation_score).toBeGreaterThanOrEqual(0);
    expect(r2.confidence).toBe(0);
  });

  test('§7.10 KB items + sample sent emails are included in the LLM prompt', async () => {
    const llmCalls: unknown[] = [];
    const deps = makeDeps({ generationScore: 0.8, llmCalls });

    await draftReply(FIXTURE_EMAIL, deps);

    expect(llmCalls).toHaveLength(1);
    const prompt = llmCalls[0] as { user: string; model: string };
    expect(prompt.model).toBe('deepseek-v4-pro');
    // KB content present
    expect(prompt.user).toContain('Widget A costs 10 fictional credits.');
    // Sample sent present (tone)
    expect(prompt.user).toContain('Thanks — confirmed.');
    // Inbound subject present
    expect(prompt.user).toContain('Synthetic question about widget pricing');
  });

  test('§7.10 throws if email has no body', async () => {
    const deps = makeDeps({ generationScore: 0.5 });
    await expect(
      draftReply({ ...FIXTURE_EMAIL, body: '' }, deps),
    ).rejects.toThrow(/body/);
  });
});

test.describe('@feature AINBOX-10 createProviderDraft placeholder', () => {
  test('returns a placeholder id with the correct provider', async () => {
    const out = await createProviderDraft('user-abc12345', 'gmail', 'hi');
    expect(out.provider).toBe('gmail');
    expect(out.is_placeholder).toBe(true);
    expect(out.provider_draft_id).toMatch(/^placeholder-gmail-/);
  });

  test('rejects unsupported provider', async () => {
    await expect(
      // @ts-expect-error invalid provider for negative test
      createProviderDraft('user', 'imap', 'body'),
    ).rejects.toThrow(/unsupported/);
  });
});
