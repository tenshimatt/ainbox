/**
 * TASKRESPONSE-47 — Edge function proxy: voice-prompt
 *
 * Nightly voice prompt synthesis — builds a per-user tone/voice guide from
 * KB items and tone-samples, persists it to voice_profiles.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 *       System action — not user-facing (service-role exception per §4.1).
 *
 * Body: { user_id?: string }  (omit to process all active users)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const VOICE_MODEL   = process.env.VOICE_MODEL ?? 'claude-haiku-4-5-20251001';
const MAX_KB_ITEMS  = 30;

// ── LLM helper ────────────────────────────────────────────────────────────

async function synthesiseVoicePrompt(
  items: Array<{ kb_type: string; content: string }>,
): Promise<string> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: VOICE_MODEL,
      max_tokens: 400,
      system:
        "Summarise this professional's email writing voice from their KB items. " +
        'Write a concise 2-4 sentence voice guide covering: tone (formal/casual), ' +
        'typical greeting and sign-off, vocabulary style, and recurring patterns. ' +
        'This guide will be injected verbatim into a draft-reply prompt — be specific and actionable. ' +
        'Output ONLY the voice guide, no preamble or labels.',
      messages: [
        { role: 'user', content: JSON.stringify(items) },
      ],
    }),
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`anthropic ${resp.status}: ${txt.slice(0, 200)}`);
  const data = JSON.parse(txt) as { content?: Array<{ text?: string }> };
  return (data.content?.[0]?.text ?? '').trim();
}

// ── Route handler ─────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // 1. Auth: CRON_SECRET bearer
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') ?? '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  // 2. Parse body
  const body = (await req.json().catch(() => ({}))) as { user_id?: string };
  const userIdFilter = typeof body.user_id === 'string' ? body.user_id : null;

  // 3. Service-role client
  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // 4. Gather active users (those with at least one KB item)
  const { data: kbRows, error: kbErr } = await supabase
    .from('kb_items')
    .select('user_id');
  if (kbErr) {
    return NextResponse.json({ error: 'fetch_users_failed', detail: kbErr.message }, { status: 500 });
  }
  const allUsers = Array.from(new Set((kbRows ?? []).map((r: { user_id: string }) => r.user_id)));
  const users = userIdFilter ? allUsers.filter((id) => id === userIdFilter) : allUsers;

  // 5. Process each user
  let profilesGenerated = 0;
  const errors: string[] = [];

  for (const userId of users) {
    try {
      const { data: items } = await supabase
        .from('kb_items')
        .select('kb_type, content, confidence')
        .eq('user_id', userId)
        .order('confidence', { ascending: false });

      if (!items || items.length === 0) continue;

      // Prioritise tone-samples then fill with other types up to MAX_KB_ITEMS.
      const toneSamples = items.filter((i: { kb_type: string }) => i.kb_type === 'tone-sample');
      const others      = items.filter((i: { kb_type: string }) => i.kb_type !== 'tone-sample');
      const capped      = [...toneSamples, ...others].slice(0, MAX_KB_ITEMS);

      const voicePrompt = await synthesiseVoicePrompt(
        capped.map((i: { kb_type: string; content: string }) => ({ kb_type: i.kb_type, content: i.content })),
      );
      if (!voicePrompt) continue;

      const { error: upsertErr } = await supabase
        .from('voice_profiles')
        .upsert(
          {
            user_id: userId,
            voice_prompt: voicePrompt,
            kb_item_count: items.length,
            tone_sample_count: toneSamples.length,
            generated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        );
      if (upsertErr) throw new Error(upsertErr.message);

      profilesGenerated += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      errors.push(`${userId.slice(0, 8)}: ${msg.slice(0, 160)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    users_examined: users.length,
    profiles_generated: profilesGenerated,
    errors,
  });
}
