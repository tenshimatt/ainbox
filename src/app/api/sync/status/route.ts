import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'in-progress',
    gmail: { progress: 60, total: 1000 },
    outlook: { progress: 40, total: 300 },
  }, { status: 200 });
}
