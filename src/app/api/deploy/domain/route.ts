/**
 * POST /api/deploy/domain — add a custom domain
 * GET  /api/deploy/domain — list configured domains
 * PRD §12.2
 */
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function POST() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
