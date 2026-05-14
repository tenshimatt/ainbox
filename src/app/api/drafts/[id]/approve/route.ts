/**
 * POST /api/drafts/[id]/approve
 *
 * TASKRESPONSE-11 (UI wiring) + TASKRESPONSE-36 (L1 feedback capture).
 *
 * Marks the draft 'approved'. The auto-send executor cron (TASKRESPONSE-31)
 * sends approved drafts past their cooling window. Captures a
 * draft_feedback row for personalization mining.
 */
import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { captureFeedback } from '@/lib/feedback/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: 'missing draft id' }, { status: 400 });

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { error: updErr } = await supabase
    .from('drafts')
    .update({ status: 'approved' })
    .eq('id', id)
    .eq('user_id', user.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  void captureFeedback(supabase, { userId: user.id, draftId: id, action: 'approve' });
  return NextResponse.json({ id, status: 'approved' });
}
