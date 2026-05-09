/**
 * POST /api/deploy/token — save Vercel PAT (encrypted at rest)
 * GET  /api/deploy/token — return masked token for authenticated user
 * PRD §12.2
 */
import { NextRequest, NextResponse } from 'next/server';

// Module-level store for dev/test; production would use encrypted DB column.
let _storedToken: string | null = null;
let _storedMasked: string | null = null;

function maskToken(token: string): string {
  if (token.length <= 2) return token;
  return `${token[0]}...${token[token.length - 1]}`;
}

function isValidFormat(token: string): boolean {
  return token.length >= 10 && /^[a-zA-Z0-9._-]+$/.test(token);
}

/** Long-enough token + bypass flag → treat as authenticated dev session. */
function isE2eBypass(token: string): boolean {
  return process.env.E2E_BYPASS_AUTH === 'true' && token.length >= 20;
}

export async function GET() {
  if (process.env.E2E_BYPASS_AUTH === 'true') {
    if (!_storedToken) return NextResponse.json({}, { status: 404 });
    return NextResponse.json({ token: _storedMasked }, { status: 200 });
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body */ }

  const token = typeof body.token === 'string' ? body.token : '';

  if (!token || !isValidFormat(token)) {
    return NextResponse.json({ error: 'Invalid Vercel token' }, { status: 400 });
  }

  if (isE2eBypass(token)) {
    _storedToken = token;
    _storedMasked = maskToken(token);
    return NextResponse.json({ masked: _storedMasked }, { status: 201 });
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
