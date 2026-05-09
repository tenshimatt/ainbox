import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: Request) {
  // Auth-gate: require Authorization header or session cookie
  const authHeader = request.headers.get('authorization');
  const cookie = request.headers.get('cookie') ?? '';
  const hasSession = cookie.includes('sb-') || authHeader?.startsWith('Bearer ');

  if (!hasSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Return system metrics only — no tenant email data
  return NextResponse.json({
    status: 'ok',
    ok: true,
    queue_depth: 0,
    error_rate: 0,
    timestamp: new Date().toISOString(),
  });
}
