import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function PATCH() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function DELETE() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
