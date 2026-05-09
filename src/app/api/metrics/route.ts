import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Counter incremented by scope upgrade flow (in-memory for now, Edge Function in prod)
let gmailScopeUpgradeTotal = 0;

export function incrementScopeUpgrade() {
  gmailScopeUpgradeTotal++;
}

export async function GET(): Promise<Response> {
  const metrics = [
    '# HELP gmail_scope_upgrade_total Total number of Gmail scope upgrade events',
    '# TYPE gmail_scope_upgrade_total counter',
    `gmail_scope_upgrade_total ${gmailScopeUpgradeTotal}`,
  ].join('\n');

  return new NextResponse(metrics, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; version=0.0.4' },
  });
}
