import { NextResponse } from 'next/server';

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return NextResponse.json({ id, verified: true }, { status: 200 });
}
