/**
 * POST /api/drafts/[id]/edit
 *
 * AINBOX-36 — user edited the draft body before approving. Updates
 * drafts.reply_body and inserts a draft_feedback row with the diff so
 * later layers can mine tone-substitution patterns.
 *
 * Request:  { body: string }
 * Response: { id, updated: true }
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { captureFeedback } from '@/lib/feedback/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: 'missing draft id' }, { status: 400 });

  const body = await req.json().catch(() => null) as { body?: string } | null;
  const newBody = body?.body;
  if (typeof newBody !== 'string' || !newBody.trim()) {
    return NextResponse.json({ error: 'body required' }, { status: 400 });
  }

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  // Fetch the current body so we can compute the diff.
  const { data: existing, error: fetchErr } = await supabase
    .from('drafts')
    .select('reply_body')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const beforeBody = existing.reply_body ?? '';
  if (beforeBody === newBody) {
    return NextResponse.json({ id, updated: false, reason: 'unchanged' });
  }

  const { error: updErr } = await supabase
    .from('drafts')
    .update({ reply_body: newBody, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  void captureFeedback(supabase, {
    userId: user.id,
    draftId: id,
    action: 'edit',
    edit: { before: beforeBody, after: newBody },
  });

  return NextResponse.json({ id, updated: true });
}
