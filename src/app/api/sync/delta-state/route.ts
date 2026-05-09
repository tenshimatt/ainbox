import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    gmail: { deltaToken: 'gmail-delta-token-abc' },
    outlook: { deltaToken: 'outlook-delta-token-xyz' },
  }, { status: 200 });
}
