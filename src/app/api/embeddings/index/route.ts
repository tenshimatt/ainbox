/**
 * PRD §7.8 Embedding pipeline — index endpoint
 *
 * POST /api/embeddings/index
 *   body: { items: Array<{ id?: string; text: string; type: string }> }
 *
 * For every item:
 *   1. chunk via chunkText (~500 tokens / chunk)
 *   2. embed all chunks via embedChunks (LiteLLM → Ollama bge-m3, 1024-d)
 *   3. upsert each chunk into kb_items as a row with the embedding vector,
 *      scoped to the calling user (RLS). The route uses the anon-keyed
 *      supabase client with the request's Authorization bearer so RLS
 *      enforces tenant isolation per PRD §4.1.
 *
 * Returns: { indexed: number, items: Array<{ id, chunks }> }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { chunkText } from '@/lib/embeddings/chunk';
import { embedChunks, toPgVector } from '@/lib/embeddings/embed';

export const runtime = 'nodejs';

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

  const results: Array<{ id: string | null; chunks: number }> = [];
  let totalChunks = 0;

  for (const item of items) {
    const chunks = chunkText(item.text);
    if (chunks.length === 0) {
      results.push({ id: item.id ?? null, chunks: 0 });
      continue;
    }
    const vectors = await embedChunks(chunks);

    // Upsert one row per chunk. Each row carries the source id in `source_id`
    // so AINBOX-4's schema can group chunks back to the originating item.
    const rows = chunks.map((content, i) => ({
      user_id: userId,
      source_id: item.id ?? null,
      type: item.type,
      content,
      embedding: toPgVector(vectors[i]),
      chunk_index: i,
    }));

    const { error: upsertErr } = await supabase
      .from('kb_items')
      .upsert(rows, { onConflict: 'user_id,source_id,chunk_index' });
    if (upsertErr) {
      return NextResponse.json(
        { error: 'upsert_failed', detail: upsertErr.message },
        { status: 500 },
      );
    }
    totalChunks += chunks.length;
    results.push({ id: item.id ?? null, chunks: chunks.length });
  }

  return NextResponse.json({ indexed: totalChunks, items: results });
}
