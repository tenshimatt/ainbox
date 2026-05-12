/**
 * Voice Prompt handler — AINBOX-47: Personalization L5.
 *
 * Nightly job (02:00 UTC): for each user with KB items, synthesises a compact
 * tone/voice guide from their KB facts and tone-samples, then persists it in
 * voice_profiles. The draft function injects this prompt to align generated
 * replies with the user's personal writing voice.
 *
 * Auth: Authorization: Bearer <CRON_SECRET> — system action, service-role
 *       exception per PRD §4.1 (not user-facing).
 *
 * Pure handler over injected deps — no Deno-specific APIs so this module can
 * be imported and tested from Node.js via Playwright.
 */

// ── Constants (re-exported so tests can assert them) ──────────────────────

/** Maximum KB items fed to the LLM per user (cost guard). */
export const MAX_KB_ITEMS = 30;

// ── Types ─────────────────────────────────────────────────────────────────

export interface KbItemRow {
  kb_type: string;
  content: string;
  confidence: number | null;
}

export interface VoiceProfileRow {
  user_id: string;
  voice_prompt: string;
  kb_item_count: number;
  tone_sample_count: number;
  generated_at: string;
}

export interface SummaryResult {
  ok: boolean;
  users_examined: number;
  profiles_generated: number;
  errors: string[];
}

/**
 * Injectable dependencies. Production wiring is in index.ts.
 * Tests inject mocks to run without network or DB.
 */
export interface HandlerDeps {
  /** Validate the shared cron secret (constant-time compare in prod). */
  validateSecret: (header: string) => boolean;
  /** Return all user IDs that have at least one KB item. */
  getActiveUsers: () => Promise<string[]>;
  /** Return KB items for a single user, ordered by confidence desc. */
  getKbItems: (userId: string) => Promise<KbItemRow[]>;
  /**
   * Call the LLM to synthesise a voice/tone guide from the user's KB items.
   * Receives the full item list (already capped to MAX_KB_ITEMS inside handler).
   */
  synthesiseVoice: (items: KbItemRow[]) => Promise<string>;
  /** Upsert a voice profile row (on-conflict user_id). */
  upsertVoiceProfile: (profile: VoiceProfileRow) => Promise<void>;
}

// ── Helper ────────────────────────────────────────────────────────────────

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Handler ───────────────────────────────────────────────────────────────

/**
 * Handle a POST /functions/v1/voice-prompt request.
 *
 * Flow:
 *  1. Verify CRON_SECRET Bearer token.
 *  2. Parse optional { user_id } body (for targeted single-user runs).
 *  3. Fetch all active users (or just the targeted one).
 *  4. For each user:
 *     a. Load KB items (all types).
 *     b. Cap to MAX_KB_ITEMS, prioritising tone-samples.
 *     c. Synthesise a voice prompt via LLM.
 *     d. Upsert into voice_profiles.
 *  5. Return { ok, users_examined, profiles_generated, errors }.
 */
export async function handleVoicePromptRequest(
  req: Request,
  deps: HandlerDeps,
): Promise<Response> {
  // CORS preflight.
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }

  // ── Auth ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization') ?? '';
  if (!deps.validateSecret(authHeader)) {
    return json({ error: 'unauthorised' }, 401);
  }

  // ── Parse body (optional user_id for targeted runs) ───────────────────
  let userIdFilter: string | null = null;
  try {
    const body = (await req.json().catch(() => ({}))) as { user_id?: unknown };
    if (typeof body.user_id === 'string' && body.user_id.trim()) {
      userIdFilter = body.user_id.trim();
    }
  } catch {
    // no body — process all users
  }

  // ── Gather users ──────────────────────────────────────────────────────
  const allUsers = await deps.getActiveUsers();
  const users = userIdFilter
    ? allUsers.filter((id) => id === userIdFilter)
    : allUsers;

  // ── Process each user ─────────────────────────────────────────────────
  let profilesGenerated = 0;
  const errors: string[] = [];

  for (const userId of users) {
    try {
      const allItems = await deps.getKbItems(userId);
      if (allItems.length === 0) continue;

      // Prioritise tone-samples, then fill remaining slots with other types.
      const toneSamples = allItems.filter((i) => i.kb_type === 'tone-sample');
      const others = allItems.filter((i) => i.kb_type !== 'tone-sample');
      const capped = [...toneSamples, ...others].slice(0, MAX_KB_ITEMS);

      const voicePrompt = await deps.synthesiseVoice(capped);
      if (!voicePrompt) continue;

      await deps.upsertVoiceProfile({
        user_id: userId,
        voice_prompt: voicePrompt,
        kb_item_count: allItems.length,
        tone_sample_count: toneSamples.length,
        generated_at: new Date().toISOString(),
      });

      profilesGenerated += 1;
    } catch (e) {
      errors.push(`${userId.slice(0, 8)}: ${(e as Error).message.slice(0, 160)}`);
    }
  }

  return json(
    {
      ok: true,
      users_examined: users.length,
      profiles_generated: profilesGenerated,
      errors,
    },
    200,
  );
}
