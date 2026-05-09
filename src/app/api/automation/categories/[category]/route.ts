import { NextResponse } from 'next/server';

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ category: string }> }
) {
  const { category } = await params;
  return NextResponse.json({ updated: true, category }, { status: 200 });
}
