/**
 * POST /api/deploy/env — add an environment variable
 * GET  /api/deploy/env — list env var keys (values never returned)
 * PRD §12.2
 */
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function POST() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
