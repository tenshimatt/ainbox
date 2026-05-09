import { NextResponse } from 'next/server';

export async function GET() {
  return new NextResponse('timestamp,model,confidence,decision_type,kb_references,email_subject\n', {
    status: 200,
    headers: { 'Content-Type': 'text/csv' },
  });
}
