/**
 * L1.5 — analyse a single reject and write a memory entry.
 * Fire-and-forget. Cheapest model (Haiku 4.5) — ~$0.0003/call.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';

const VALID_KINDS = ['reject_pattern', 'content_avoid', 'sender_preference', 'approve_pattern', 'content_prefer'] as const;

export async function analyseReject(
  supabase: SupabaseClient,
  userId: string,
  draftId: string,
): Promise<void> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn('[analyse] ANTHROPIC_API_KEY missing — skipping');
      return;
    }

    const { data: draft } = await supabase
      .from('drafts')
      .select('reply_body, email_messages(subject, body_preview, from_addr, category)')
      .eq('id', draftId)
      .maybeSingle();
    if (!draft) return;
    const em = (draft as { email_messages?: unknown }).email_messages;
    const emObj = Array.isArray(em) ? em[0] : em;

    const payload = {
      sender:   (emObj as { from_addr?: string } | undefined)?.from_addr ?? '',
      subject:  (emObj as { subject?: string } | undefined)?.subject ?? '',
      preview:  (emObj as { body_preview?: string } | undefined)?.body_preview ?? '',
      category: (emObj as { category?: string } | undefined)?.category ?? '',
      drafted_reply: (draft as { reply_body?: string }).reply_body ?? '',
    };

    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        system:
          'A user just rejected a draft reply. Identify the single most likely reason ' +
          'in one short sentence. Pick a kind from: reject_pattern | content_avoid | sender_preference. ' +
          'Return JSON only: {"kind":"<one>","signal":"<short reason>"}. No prose.',
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
      }),
    });
    if (!resp.ok) {
      console.warn('[analyse] anthropic non-ok', resp.status);
      return;
    }
    const data = await resp.json();
    const text = data.content?.[0]?.text ?? '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return;
    const parsed = JSON.parse(m[0]) as { kind?: string; signal?: string };
    if (!parsed.signal || !VALID_KINDS.includes(parsed.kind as typeof VALID_KINDS[number])) return;

    await supabase.from('user_memory').insert({
      user_id: userId,
      kind: parsed.kind,
      signal: parsed.signal.slice(0, 300),
      context: payload,
    });
  } catch (err) {
    console.warn('[analyse] unhandled', err instanceof Error ? err.message : String(err));
  }
}
