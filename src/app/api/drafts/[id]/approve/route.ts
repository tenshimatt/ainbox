import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ drafted: true }, { status: 200 });
}
