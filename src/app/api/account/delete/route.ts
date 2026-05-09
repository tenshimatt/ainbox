import { NextResponse } from 'next/server';

export async function DELETE() {
  return NextResponse.json({ deleted: true }, { status: 200 });
}
