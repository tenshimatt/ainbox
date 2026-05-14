/**
 * TASKRESPONSE-16 — Edge function: kb-extract
 * PRD: §4.4 §7.6 §7.7
 *
 * Scheduled / webhook-driven knowledge extraction job. Fetches a user's
 * unprocessed emails, extracts typed KB items via LiteLLM, persists them to
 * kb_items, marks emails as processed, and kicks off embedding.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 *       Uses the service-role key (system action, not user-facing).
 *
 * Body: { user_id: string; limit?: number }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { extractKbItems, type EmailMessage, type KbItem } from '@/lib/kb/extract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 200;

async function maybeEmbed(items: KbItem[]): Promise<void> {
  if (!items.length) return;
  try {
    const mod: { embedChunks?: (texts: string[]) => Promise<number[][]> } =
      await import('@/lib/embeddings/embed').catch(() => ({}));
    if (typeof mod.embedChunks === 'function') {
      await mod.embedChunks(items.map((i) => i.content));
    }
  } catch (err) {
    console.error('[edge/kb-extract] embedding kickoff failed', err);
  }
}

export async function POST(req: Request) {
  // 1. Auth: CRON_SECRET bearer
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') ?? '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  // 2. Parse body
  const body = (await req.json().catch(() => ({}))) as {
    user_id?: string;
    limit?: number;
  };
  if (!body.user_id || typeof body.user_id !== 'string') {
    return NextResponse.json({ error: 'user_id_required' }, { status: 400 });
  }
  const userId = body.user_id;
  const limit = Math.min(Math.max(body.limit ?? DEFAULT_LIMIT, 1), 1000);

  // 3. Service-role client (cron/system action — not user-facing per §9.4)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // 4. Fetch unprocessed emails for this user
  const { data, error: fetchErr } = await supabase
    .from('email_messages')
    .select('id, subject, from_address, to_address, body, sent_at')
    .eq('user_id', userId)
    .is('kb_extracted_at', null)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (fetchErr) {
    return NextResponse.json(
      { error: 'fetch_failed', detail: fetchErr.message },
      { status: 500 },
    );
  }

  const emails = (data ?? []) as EmailMessage[];

  // 5. Extract KB items via LiteLLM
  let extracted: KbItem[] = [];
  try {
    extracted = await extractKbItems(userId, emails);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: 'extract_failed', detail: msg }, { status: 500 });
  }

  // 6. Persist extracted items
  let inserted: KbItem[] = extracted;
  if (extracted.length) {
    const { data: ins, error: insErr } = await supabase
      .from('kb_items')
      .insert(extracted)
      .select('*');
    if (insErr) {
      return NextResponse.json(
        { error: 'persist_failed', detail: insErr.message },
        { status: 500 },
      );
    }
    inserted = (ins ?? extracted) as KbItem[];

    // 7. Mark emails as processed (best-effort)
    const ids = Array.from(new Set(emails.map((e) => e.id)));
    if (ids.length) {
      await supabase
        .from('email_messages')
        .update({ kb_extracted_at: new Date().toISOString() })
        .in('id', ids)
        .eq('user_id', userId);
    }
  }

  // 8. Kick off embedding pipeline (best-effort, non-blocking)
  await maybeEmbed(inserted);

  return NextResponse.json({
    ok: true,
    user_id: userId,
    extracted: inserted.length,
    processed_emails: emails.length,
  });
}
