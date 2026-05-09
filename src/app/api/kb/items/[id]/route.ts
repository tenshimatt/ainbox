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
    // optional dependency from AINBOX-7
    const mod: { embedChunks?: (xs: { content: string }[]) => Promise<unknown> } =
      // @ts-expect-error optional peer module
      await import('@/lib/embeddings/embed').catch(() => ({}));
    if (typeof mod.embedChunks === 'function') {
      await mod.embedChunks([{ content }]);
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
    const update: Record<string, unknown> = {};
    if (typeof body.content === 'string' && body.content.trim()) {
      update.content = body.content.trim();
    }
    if (body.type && KB_ITEM_TYPES.includes(body.type)) {
      update.type = body.type;
    }
    if (typeof body.human_verified === 'boolean') {
      update.human_verified = body.human_verified;
    }
    if (!Object.keys(update).length) {
      return NextResponse.json({ error: 'no_fields' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('kb_items')
      .update(update)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('*')
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

    return NextResponse.json({ ok: true, item: data });
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
