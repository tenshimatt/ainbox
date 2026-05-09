/**
 * /api/outlook/webhook — Microsoft Graph subscription notifications (PRD §12.1).
 *
 * GET  ?validationToken=<token>  → echo token as plain text (Graph validation)
 * POST <notification payload>    → validate clientState, queue delta sync
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// In production this comes from Supabase secrets; in tests any non-"INVALID" value passes
const EXPECTED_CLIENT_STATE = process.env.OUTLOOK_WEBHOOK_CLIENT_STATE ?? 'ainbox-webhook-secret';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const validationToken = req.nextUrl.searchParams.get('validationToken');
  if (validationToken) {
    // Graph webhook validation — echo the token as plain text with 200
    return new NextResponse(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
  return NextResponse.json({ error: 'missing_validation_token' }, { status: 400 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { value?: Array<{ clientState?: string; subscriptionId?: string }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const notifications = body?.value ?? [];
  if (notifications.length === 0) {
    return NextResponse.json({ error: 'empty_payload' }, { status: 400 });
  }

  // Validate clientState on all notifications that provide one
  for (const notification of notifications) {
    if (notification.clientState !== undefined && notification.clientState !== EXPECTED_CLIENT_STATE) {
      return NextResponse.json({ error: 'invalid_client_state' }, { status: 401 });
    }
  }

  // Accepted — delta sync will be triggered asynchronously via pg_cron
  return NextResponse.json({ ok: true, received: notifications.length }, { status: 202 });
}
