import { NextResponse } from 'next/server';

/**
 * AINBOX-11 — POST /api/drafts/[id]/approve
 * PRD §7.11 Approval queue UI
 *
 * Approves a draft and sends it via the user's provider.
 * The actual provider-send is implemented in AINBOX-12; here we call
 * a placeholder `sendDraft(userId, draftId)` so wiring exists today.
 */

// Placeholder — AINBOX-12 will replace this with the real Gmail/Graph send.
// Kept inline so this route is self-contained until the helper module lands.
async function sendDraft(_userId: string, _draftId: string): Promise<{ sent: true }> {
  return { sent: true };
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: 'missing draft id' }, { status: 400 });
  }
  // TODO (AINBOX-12): resolve userId from Supabase auth + RLS, then send.
  const userId = 'placeholder-user';
  try {
    const result = await sendDraft(userId, id);
    return NextResponse.json({ id, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'send failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
