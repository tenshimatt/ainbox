/**
 * POST /api/kb/extract
 * AINBOX-8 — Run KB extraction over the authenticated user's recent
 * unsynced emails, persist kb_items, kick off embedding indexing.
 * PRD: §4.4 §7.6 §7.7
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { extractKbItems, type EmailMessage, type KbItem } from '@/lib/kb/extract';

export const dynamic = 'force-dynamic';

async function getSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet: { name: string; value: string; options?: Record<string, unknown> }[]) => {
          for (const { name, value, options } of toSet) {
            try {
              cookieStore.set(name, value, options);
            } catch {
              /* read-only context, ignore */
            }
          }
        },
      },
    },
  );
}

async function maybeEmbed(items: KbItem[]): Promise<void> {
  if (!items.length) return;
  try {
    // dynamic import — AINBOX-7 owns this module; tolerate absence in tests.
    const mod: { embedChunks?: (texts: string[], opts?: Record<string, unknown>) => Promise<number[][]> } =
      await import('@/lib/embeddings/embed').catch(() => ({}));
    if (typeof mod.embedChunks === 'function') {
      await mod.embedChunks(items.map((i) => i.content));
    }
  } catch (err) {
    console.error('[kb/extract] embedding kickoff failed', err);
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await getSupabase();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      limit?: number;
      emails?: EmailMessage[];
    };
    const limit = Math.min(Math.max(body.limit ?? 200, 1), 1000);

    let emails: EmailMessage[] = body.emails ?? [];
    if (!emails.length) {
      const { data, error } = await supabase
        .from('email_messages')
        .select('id, subject, from_address, to_address, body, sent_at, kb_extracted_at')
        .eq('user_id', user.id)
        .is('kb_extracted_at', null)
        .order('sent_at', { ascending: false })
        .limit(limit);
      if (error) {
        return NextResponse.json({ error: 'fetch_failed', detail: error.message }, { status: 500 });
      }
      emails = (data ?? []) as EmailMessage[];
    }

    const items = await extractKbItems(user.id, emails);

    let inserted: KbItem[] = items;
    if (items.length) {
      const { data: ins, error: insErr } = await supabase
        .from('kb_items')
        .insert(items)
        .select('*');
      if (insErr) {
        return NextResponse.json(
          { error: 'persist_failed', detail: insErr.message },
          { status: 500 },
        );
      }
      inserted = (ins ?? items) as KbItem[];

      // mark emails as processed (best-effort)
      const ids = Array.from(new Set(emails.map((e) => e.id)));
      if (ids.length) {
        await supabase
          .from('email_messages')
          .update({ kb_extracted_at: new Date().toISOString() })
          .in('id', ids)
          .eq('user_id', user.id);
      }
    }

    await maybeEmbed(inserted);

    return NextResponse.json({
      ok: true,
      extracted: inserted.length,
      processed_emails: emails.length,
      items: inserted,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: 'extract_failed', detail: msg }, { status: 500 });
  }
}
