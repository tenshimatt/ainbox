import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const authHeader = req.headers.get('authorization');
  const cookieHeader = req.headers.get('cookie');

  if (!authHeader?.startsWith('Bearer ') && !cookieHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({ queued_reembed: true }, { status: 202 });
}
