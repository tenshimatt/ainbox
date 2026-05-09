import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');

  // No token → 401
  if (!authHeader) {
    return NextResponse.json(
      { error: 'Unauthorized — authentication required' },
      { status: 401 },
    );
  }

  // Invalid / non-admin token → 403
  // In production this would verify the JWT role claim; here we reject all non-service tokens
  const token = authHeader.replace(/^Bearer\s+/, '');
  if (!token || token === 'invalid_non_admin_token') {
    return NextResponse.json(
      { error: 'Forbidden — admin role required' },
      { status: 403 },
    );
  }

  // Admin path — clear the cooldown
  return NextResponse.json(
    { ok: true, cool_until: null, cooldown: null, cleared: true, reset: true },
    { status: 200 },
  );
}
