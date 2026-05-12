/**
 * AINBOX-52 — Quality L2: draft hard-skip when body greeting names someone
 * other than the user.
 *
 * Tests `generateDraftForEmail` (LiteLLM path) and the standalone
 * `greetingNamesOther` utility.
 *
 * No real email content in fixtures (factory-rules §8 / PRD §9.3).
 */

import { test, expect } from '@playwright/test';
import {
  generateDraftForEmail,
  greetingNamesOther,
  type GenerateDraftSupabaseLike,
} from '../../src/lib/draft/generate';

// ---- synthesised fixtures (no real PII) ----

const FIXTURE_USER_ID  = 'user-ainbox52-fixture-001';
const FIXTURE_EMAIL_ID = 'email-ainbox52-fixture-001';
const FIXTURE_DRAFT_ID = 'draft-ainbox52-fixture-001';

const FIXTURE_KB_RPC_DATA = [
  { id: 'kb-ainbox52-a', content: 'SLA policy: 24h standard tier.', similarity: 0.85 },
];

/** Build a minimal Supabase-like mock. */
function makeSupabase(opts: {
  bodyPreview?: string;
  emailRow?: Record<string, unknown> | null;
  draftInserts?: Record<string, unknown>[];
}): GenerateDraftSupabaseLike {
  const draftInserts = opts.draftInserts ?? [];
  const emailRow = 'emailRow' in opts
    ? opts.emailRow
    : {
        id: FIXTURE_EMAIL_ID,
        user_id: FIXTURE_USER_ID,
        subject: 'Synthetic enquiry about support',
        body_preview: opts.bodyPreview ?? 'Synthesised body text with no greeting name.',
        sender: 'synth at ainbox52.test',
        category: 'support',
      };

  const terminal = () => ({
    async maybeSingle() {
      return { data: emailRow ?? null, error: null };
    },
    order(_col: string, _opts?: unknown) {
      return { limit: (_n: number) => Promise.resolve({ data: [], error: null }) };
    },
  });

  return {
    from(table: string) {
      if (table === 'email_messages') {
        return {
          select(_cols: string) {
            return {
              eq(_c: string, _v: unknown) {
                return { ...terminal(), eq(_c2: string, _v2: unknown) { return terminal(); } };
              },
            };
          },
        };
      }
      if (table === 'drafts') {
        return {
          insert(row: Record<string, unknown>) {
            draftInserts.push(row);
            return {
              select(_cols: string) {
                return {
                  async single() {
                    return { data: { id: FIXTURE_DRAFT_ID }, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'audit_log') {
        return { async insert(_row: unknown) { return { error: null }; } };
      }
      throw new Error(`makeSupabase: unexpected table "${table}"`);
    },
    async rpc(_fn: string, _params: Record<string, unknown>) {
      return { data: FIXTURE_KB_RPC_DATA, error: null };
    },
  };
}

function makeCallLlm(body = 'Synthetic reply from AINBOX-52 test.', generationScore = 0.80) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (_prompt: any) => ({ body, generation_score: generationScore });
}

function makeEmbedder() {
  return async (_chunks: string[]): Promise<number[][]> => [new Array(1024).fill(0.01)];
}

// ---- greetingNamesOther unit tests ----

test.describe('@feature AINBOX-52 greetingNamesOther utility', () => {
  test('returns false when preview is null', () => {
    expect(greetingNamesOther(null, 'Alice Smith')).toBe(false);
  });

  test('returns false when fullName is null', () => {
    expect(greetingNamesOther('Hi Bob, how are you?', null)).toBe(false);
  });

  test('returns false when no greeting found in body', () => {
    expect(greetingNamesOther('Please find the invoice attached.', 'Alice Smith')).toBe(false);
  });

  test('returns false when greeting matches user first name', () => {
    expect(greetingNamesOther('Hi Alice, thanks for reaching out.', 'Alice Smith')).toBe(false);
  });

  test('returns false when greeting matches full name case-insensitively', () => {
    expect(greetingNamesOther('Dear alice smith, your order is ready.', 'Alice Smith')).toBe(false);
  });

  test('returns true when greeting names someone else', () => {
    expect(greetingNamesOther('Hi Bob, could you help us?', 'Alice Smith')).toBe(true);
  });

  test('returns true for Dear <other name> form', () => {
    expect(greetingNamesOther('Dear Charlie, please review the proposal.', 'Alice Smith')).toBe(true);
  });

  test('returns true for Hello <other name> form', () => {
    expect(greetingNamesOther('Hello Dave, just following up.', 'Alice Smith')).toBe(true);
  });

  test('returns false for generic "Hi there" — not a person name', () => {
    expect(greetingNamesOther('Hi there, we wanted to let you know...', 'Alice Smith')).toBe(false);
  });

  test('returns false for generic "Hi team"', () => {
    expect(greetingNamesOther('Hi team, please review this doc.', 'Alice Smith')).toBe(false);
  });

  test('returns false for generic "Dear Sir"', () => {
    expect(greetingNamesOther('Dear Sir, we are pleased to offer...', 'Alice Smith')).toBe(false);
  });

  test('returns false for generic "Hello everyone"', () => {
    expect(greetingNamesOther('Hello everyone, thanks for joining.', 'Alice Smith')).toBe(false);
  });

  test('returns false when fullName is too short (single char)', () => {
    expect(greetingNamesOther('Hi Bob, thanks.', 'A')).toBe(false);
  });
});

// ---- generateDraftForEmail integration tests ----

test.describe('@feature AINBOX-52 generateDraftForEmail hard-skip integration', () => {
  test('hard-skips when greeting names someone other than the user', async () => {
    const supabase = makeSupabase({
      bodyPreview: 'Hi Bob, could you review the attached contract?',
    });

    await expect(
      generateDraftForEmail(
        supabase,
        FIXTURE_USER_ID,
        FIXTURE_EMAIL_ID,
        {
          callLlm: makeCallLlm(),
          embedder: makeEmbedder(),
          userFullName: 'Alice Smith',
        },
      ),
    ).rejects.toThrow(/hard-skip.*greeting names other/);
  });

  test('does NOT skip when greeting matches the user', async () => {
    const draftInserts: Record<string, unknown>[] = [];
    const supabase = makeSupabase({
      bodyPreview: 'Hi Alice, could you review the attached contract?',
      draftInserts,
    });

    const result = await generateDraftForEmail(
      supabase,
      FIXTURE_USER_ID,
      FIXTURE_EMAIL_ID,
      {
        callLlm: makeCallLlm(),
        embedder: makeEmbedder(),
        userFullName: 'Alice Smith',
      },
    );

    expect(result.draft_id).toBeTruthy();
    expect(draftInserts).toHaveLength(1);
    expect((draftInserts[0] as Record<string, unknown>).status).toBe('pending');
  });

  test('does NOT skip when there is no greeting name in the body', async () => {
    const draftInserts: Record<string, unknown>[] = [];
    const supabase = makeSupabase({
      bodyPreview: 'Please find the attached invoice for your records.',
      draftInserts,
    });

    const result = await generateDraftForEmail(
      supabase,
      FIXTURE_USER_ID,
      FIXTURE_EMAIL_ID,
      {
        callLlm: makeCallLlm(),
        embedder: makeEmbedder(),
        userFullName: 'Alice Smith',
      },
    );

    expect(result.draft_id).toBeTruthy();
    expect(draftInserts).toHaveLength(1);
  });

  test('does NOT skip when userFullName is not provided (backwards compat)', async () => {
    const draftInserts: Record<string, unknown>[] = [];
    const supabase = makeSupabase({
      bodyPreview: 'Hi Bob, could you review the contract?',
      draftInserts,
    });

    const result = await generateDraftForEmail(
      supabase,
      FIXTURE_USER_ID,
      FIXTURE_EMAIL_ID,
      {
        callLlm: makeCallLlm(),
        embedder: makeEmbedder(),
        // userFullName intentionally omitted — feature must not break callers that don't pass it
      },
    );

    expect(result.draft_id).toBeTruthy();
    expect(draftInserts).toHaveLength(1);
  });

  test('does NOT skip for generic greeting "Hi there" even if user name differs', async () => {
    const draftInserts: Record<string, unknown>[] = [];
    const supabase = makeSupabase({
      bodyPreview: 'Hi there, we wanted to follow up on your recent enquiry.',
      draftInserts,
    });

    const result = await generateDraftForEmail(
      supabase,
      FIXTURE_USER_ID,
      FIXTURE_EMAIL_ID,
      {
        callLlm: makeCallLlm(),
        embedder: makeEmbedder(),
        userFullName: 'Alice Smith',
      },
    );

    expect(result.draft_id).toBeTruthy();
    expect(draftInserts).toHaveLength(1);
  });

  test('hard-skip on "Dear Charlie" when user is Alice', async () => {
    const supabase = makeSupabase({
      bodyPreview: 'Dear Charlie, please find the updated proposal attached.',
    });

    await expect(
      generateDraftForEmail(
        supabase,
        FIXTURE_USER_ID,
        FIXTURE_EMAIL_ID,
        {
          callLlm: makeCallLlm(),
          embedder: makeEmbedder(),
          userFullName: 'Alice Smith',
        },
      ),
    ).rejects.toThrow(/hard-skip/);
  });
});
