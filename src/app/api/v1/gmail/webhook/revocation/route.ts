import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  // Require a shared secret header for signature validation
  const secret = request.headers.get('x-webhook-secret');
  const expectedSecret = process.env.GMAIL_WEBHOOK_SECRET;

  if (!secret || !expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: 'unauthorized: missing or invalid signature' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.connection_id) {
    return NextResponse.json({ error: 'connection_id required' }, { status: 400 });
  }

  // Mark scope as revoked — handled by Edge Function in production
  return NextResponse.json({ ok: true, connection_id: body.connection_id });
}
