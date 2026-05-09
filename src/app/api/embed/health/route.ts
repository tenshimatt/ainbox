import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    provider: 'ollama',
    model: 'bge-m3',
    dimension: 1024,
  }, { status: 200 });
}
