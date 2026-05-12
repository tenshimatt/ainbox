/**
 * PRD §7.8 Embedding pipeline — index endpoint
 *
 * POST /api/embeddings/index
 *   body: { items: Array<{ id?: string; text: string; type: string }> }
 *
 * For every item:
 *   1. chunk via chunkText (~500 tokens / chunk)
 *   2. embed all chunks via embedChunks (LiteLLM → Ollama bge-m3, 1024-d)
 *   3. AINBOX-51: skip any chunk whose embedding is within cosine 0.9 of an
 *      existing kb_item of the same type (kb_near_duplicate_exists RPC)
 *   4. upsert each non-duplicate chunk into kb_items as a row with the
 *      embedding vector, scoped to the calling user (RLS). The route uses
 *      the anon-keyed supabase client with the request's Authorization bearer
 *      so RLS enforces tenant isolation per PRD §4.1.
 *
 * Returns: { indexed: number, skipped: number, items: Array<{ id, chunks, skipped }> }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { chunkText } from '@/lib/embeddings/chunk';
import { embedChunks, toPgVector } from '@/lib/embeddings/embed';

export const runtime = 'nodejs';

const DEDUP_THRESHOLD = 0.9;

interface IndexItem {
  id?: string;
  text: string;
  type: string;
}

export async function POST(req: NextRequest) {
  let payload: { items?: IndexItem[] };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const items = Array.isArray(payload?.items) ? payload!.items! : [];
  if (items.length === 0) {
    return NextResponse.json({ error: 'no_items' }, { status: 400 });
  }
  for (const it of items) {
    if (!it || typeof it.text !== 'string' || typeof it.type !== 'string') {
      return NextResponse.json({ error: 'invalid_item' }, { status: 400 });
    }
  }

  const auth = req.headers.get('authorization') ?? '';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!supabaseUrl || !supabaseAnon) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500 });
  }
  if (!auth) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: auth } },
  });

  // Resolve current user — RLS still enforces, but we want a clean 401 path.
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = userData.user.id;

  const results: Array<{ id: string | null; chunks: number; skipped: number }> = [];
  let totalChunks = 0;
  let totalSkipped = 0;

  for (const item of items) {
    const chunks = chunkText(item.text);
    if (chunks.length === 0) {
      results.push({ id: item.id ?? null, chunks: 0, skipped: 0 });
      continue;
    }
    const vectors = await embedChunks(chunks);

    let itemSkipped = 0;
    const rows: Array<{
      user_id: string;
      source_id: string | null;
      kb_type: string;
      content: string;
      embedding: string;
      chunk_index: number;
    }> = [];

    for (let i = 0; i < chunks.length; i++) {
      // AINBOX-51: skip near-duplicates (cosine >= 0.9, same kb_type)
      const { data: isDup } = await supabase.rpc('kb_near_duplicate_exists', {
        p_user_id:   userId,
        p_kb_type:   item.type,
        p_embedding: toPgVector(vectors[i]),
        p_threshold: DEDUP_THRESHOLD,
      });
      if (isDup) {
        itemSkipped += 1;
        continue;
      }
      rows.push({
        user_id:     userId,
        source_id:   item.id ?? null,
        kb_type:     item.type,
        content:     chunks[i],
        embedding:   toPgVector(vectors[i]),
        chunk_index: i,
      });
    }

    if (rows.length > 0) {
      const { error: upsertErr } = await supabase
        .from('kb_items')
        .upsert(rows, { onConflict: 'user_id,source_id,chunk_index' });
      if (upsertErr) {
        return NextResponse.json(
          { error: 'upsert_failed', detail: upsertErr.message },
          { status: 500 },
        );
      }
    }

    totalChunks += rows.length;
    totalSkipped += itemSkipped;
    results.push({ id: item.id ?? null, chunks: rows.length, skipped: itemSkipped });
  }

  return NextResponse.json({ indexed: totalChunks, skipped: totalSkipped, items: results });
}
