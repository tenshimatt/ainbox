import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const sessionCookie = req.cookies.get('sb-access-token') || req.cookies.get('supabase-auth-token');
  if (!authHeader && !sessionCookie) {
    return NextResponse.json({ error: 'Unauthorized', sent: false }, { status: 401 });
  }

  // Idempotent: in production this checks a per-user flag in DB
  // For now, return success
  return NextResponse.json({ sent: true }, { status: 200 });
}
