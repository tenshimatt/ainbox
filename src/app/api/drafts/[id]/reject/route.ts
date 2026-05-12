/**
 * POST /api/drafts/[id]/reject
 *
 * AINBOX-11 + AINBOX-36 — marks the draft 'rejected' and captures
 * a draft_feedback row.
 */
import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { captureFeedback } from '@/lib/feedback/capture';
import { analyseReject } from '@/lib/feedback/analyse';

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
    .update({ status: 'rejected' })
    .eq('id', id)
    .eq('user_id', user.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  void captureFeedback(supabase, { userId: user.id, draftId: id, action: 'reject' });
  // L1.5 — analyse the reject and write a user_memory entry. Fire-and-forget.
  void analyseReject(supabase, user.id, id);
  return NextResponse.json({ id, status: 'rejected' });
}
