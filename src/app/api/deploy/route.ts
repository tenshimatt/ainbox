/**
 * POST /api/deploy — trigger a deployment (returns 202 + deploymentId)
 * GET  /api/deploy — list all deployments for the authenticated user
 * PRD §12.2
 */
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function POST() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
