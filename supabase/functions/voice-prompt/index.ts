/**
 * Supabase Edge Function: voice-prompt
 * AINBOX-47: Personalization L5 — nightly voice prompt synthesis.
 *
 * Triggered by pg_cron at 02:00 UTC every night. For each user with KB items,
 * synthesises a compact tone/voice description from their KB facts and
 * tone-samples, and upserts it into voice_profiles. The draft function injects
 * this to ensure generated replies match the user's personal writing voice.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 * Request:  POST /functions/v1/voice-prompt  Body: { "user_id"?: string }
 * Response: { ok, users_examined, profiles_generated, errors }
 *
 * Deno entry point — see ./handler.ts for the pure, testable HTTP handler.
 */

// @deno-types="npm:@supabase/supabase-js@^2"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  handleVoicePromptRequest,
  type HandlerDeps,
  type KbItemRow,
  MAX_KB_ITEMS,
} from './handler.ts';

// ── Config ────────────────────────────────────────────────────────────────

const CRON_SECRET     = Deno.env.get('CRON_SECRET') ?? '';
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANTHROPIC_KEY   = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
// Use Haiku for cost efficiency — voice synthesis is lightweight.
const MODEL           = Deno.env.get('VOICE_MODEL') ?? 'claude-haiku-4-5-20251001';

// ── LLM synthesis ─────────────────────────────────────────────────────────

async function synthesiseViaAnthropic(items: KbItemRow[]): Promise<string> {
  // Items are already capped and tone-sample-prioritised by the handler.
  const payload = items
    .slice(0, MAX_KB_ITEMS)
    .map((i) => ({ type: i.kb_type, content: i.content }));

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system:
        "Summarise this professional's email writing voice from their KB items. " +
        'Write a concise 2-4 sentence voice guide covering: tone (formal/casual), ' +
        'typical greeting and sign-off, vocabulary style, and recurring patterns. ' +
        'This guide will be injected verbatim into a draft-reply prompt — be specific and actionable. ' +
        'Output ONLY the voice guide, no preamble or labels.',
      messages: [
        { role: 'user', content: JSON.stringify(payload) },
      ],
    }),
  });

  const txt = await resp.text();
  if (!resp.ok) throw new Error(`anthropic ${resp.status}: ${txt.slice(0, 200)}`);
  const data = JSON.parse(txt);
  return (data.content?.[0]?.text ?? '').trim();
}

// ── Deno.serve entry point ────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const deps: HandlerDeps = {
    validateSecret(header: string): boolean {
      if (!CRON_SECRET) return false;
      return header === `Bearer ${CRON_SECRET}`;
    },

    async getActiveUsers(): Promise<string[]> {
      const { data } = await supabase
        .from('kb_items')
        .select('user_id');
      return Array.from(
        new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)),
      );
    },

    async getKbItems(userId: string): Promise<KbItemRow[]> {
      const { data } = await supabase
        .from('kb_items')
        .select('kb_type, content, confidence')
        .eq('user_id', userId)
        .order('confidence', { ascending: false });
      return (data ?? []) as KbItemRow[];
    },

    async synthesiseVoice(items: KbItemRow[]): Promise<string> {
      return synthesiseViaAnthropic(items);
    },

    async upsertVoiceProfile(profile) {
      const { error } = await supabase
        .from('voice_profiles')
        .upsert(profile, { onConflict: 'user_id' });
      if (error) throw new Error(error.message);
    },
  };

  return handleVoicePromptRequest(req, deps);
});
