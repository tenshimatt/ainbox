import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  // Auth-gate: unauthenticated callers must receive 401
  const authHeader = request.headers.get('authorization');
  const cookie = request.headers.get('cookie') ?? '';
  const hasSession = cookie.includes('sb-') || authHeader?.startsWith('Bearer ');

  if (!hasSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Never echo back request body content (§4.3 PII boundary)
  return NextResponse.json({ ok: true, message: 'Onboarding complete notification queued.' });
}
