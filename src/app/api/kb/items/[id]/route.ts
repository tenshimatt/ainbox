/**
 * PATCH /api/kb/items/[id]
 * DELETE /api/kb/items/[id]
 * AINBOX-8 — User verifies / edits / discards an extracted KB item.
 * PRD: §7.7
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { KB_ITEM_TYPES, type KbItemType } from '@/lib/kb/extract';

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
              /* read-only */
            }
          }
        },
      },
    },
  );
}

interface PatchBody {
  content?: string;
  type?: KbItemType;
  human_verified?: boolean;
}

async function maybeReembed(content: string): Promise<void> {
  try {
    // optional dependency from AINBOX-7 — embed module may not exist in test env
    const mod: { embedChunks?: (texts: string[]) => Promise<number[][]> } =
      await import('@/lib/embeddings/embed').catch(() => ({}));
    if (typeof mod.embedChunks === 'function') {
      await mod.embedChunks([content]);
    }
  } catch (err) {
    console.error('[kb/items PATCH] re-embed failed', err);
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const supabase = await getSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as PatchBody;
    // UI uses { type, human_verified }; DB columns are { kb_type, verified }.
    // Mapping happens once here, mirroring the GET route's read-side mapping.
    const update: Record<string, unknown> = {};
    if (typeof body.content === 'string' && body.content.trim()) {
      update.content = body.content.trim();
    }
    if (body.type && KB_ITEM_TYPES.includes(body.type)) {
      update.kb_type = body.type;
    }
    if (typeof body.human_verified === 'boolean') {
      update.verified = body.human_verified;
    }
    if (!Object.keys(update).length) {
      return NextResponse.json({ error: 'no_fields' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('kb_items')
      .update(update)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, user_id, kb_type, content, confidence, source_email_id, verified, created_at')
      .single();

    if (error) {
      return NextResponse.json({ error: 'update_failed', detail: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    if (typeof update.content === 'string') {
      await maybeReembed(update.content as string);
    }

    // Map DB shape back to UI shape (same as GET).
    const row = data as {
      id: string; user_id: string; kb_type: KbItemType; content: string;
      confidence: number; source_email_id: string | null; verified: boolean;
      created_at?: string;
    };
    const item = {
      id: row.id,
      user_id: row.user_id,
      type: row.kb_type,
      content: row.content,
      confidence: row.confidence,
      source_email_id: row.source_email_id,
      human_verified: row.verified,
      created_at: row.created_at,
    };
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: 'patch_failed', detail: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const supabase = await getSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { error } = await supabase
      .from('kb_items')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) {
      return NextResponse.json({ error: 'delete_failed', detail: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: 'delete_failed', detail: msg }, { status: 500 });
  }
}
