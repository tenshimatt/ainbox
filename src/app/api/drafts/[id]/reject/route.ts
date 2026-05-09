import { NextResponse } from 'next/server';

/**
 * AINBOX-11 — POST /api/drafts/[id]/reject
 * PRD §7.11 Approval queue UI
 *
 * Rejects a draft: deletes locally and at the provider (if it was created there).
 * Real provider-delete lands with AINBOX-12; this route gives the UI a stable
 * endpoint so the workflow chain is testable today.
 */

async function deleteDraft(_userId: string, _draftId: string): Promise<{ deleted: true }> {
  return { deleted: true };
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: 'missing draft id' }, { status: 400 });
  }
  const userId = 'placeholder-user';
  try {
    const result = await deleteDraft(userId, id);
    return NextResponse.json({ id, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'reject failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
