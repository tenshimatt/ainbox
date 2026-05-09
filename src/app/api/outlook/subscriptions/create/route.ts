/**
 * POST /api/outlook/subscriptions/create — create a Microsoft Graph push subscription (PRD §12.1).
 * Returns 401 if unauthenticated or no Outlook token.
 */
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: () => {},
        },
      },
    );
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const { data: tokenRow } = await supabase
      .from('oauth_tokens')
      .select('access_token')
      .eq('user_id', data.user.id)
      .eq('provider', 'microsoft')
      .maybeSingle();

    if (!tokenRow?.access_token) {
      return NextResponse.json({ error: 'no_outlook_token' }, { status: 400 });
    }

    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/outlook/webhook`;
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days
    const clientState = process.env.OUTLOOK_WEBHOOK_CLIENT_STATE ?? 'ainbox-webhook-secret';

    const graphResp = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenRow.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changeType: 'created,updated',
        notificationUrl: webhookUrl,
        resource: 'me/mailFolders/inbox/messages',
        expirationDateTime: expiresAt,
        clientState,
      }),
    });

    if (!graphResp.ok) {
      const err = await graphResp.json().catch(() => ({}));
      return NextResponse.json({ error: 'graph_error', detail: err }, { status: 502 });
    }

    const subscription = await graphResp.json();
    return NextResponse.json({ ok: true, subscriptionId: subscription.id }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
}
