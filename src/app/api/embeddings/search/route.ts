/**
 * PRD §4.4 Confidence model (retrieval_score = max cosine similarity)
 * PRD §7.8 Embedding pipeline — search endpoint
 *
 * POST /api/embeddings/search
 *   body: { query: string, limit?: number }
 *
 * Embeds the query via LiteLLM → Ollama bge-m3 (1024-d) and runs a
 * cosine-similarity nearest-neighbour search against the calling user's
 * `kb_items` rows. RLS enforces tenant isolation.
 *
 * The DB-side ranking lives in a SECURITY INVOKER RPC `match_kb_items`
 * (see supabase/migrations/0002_embeddings_trigger.sql). The RPC accepts
 * a vector and a limit and returns the top-N rows by `1 - (embedding <=> q)`.
 *
 * Returns: { results: Array<{ id, type, content, similarity }> }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { embedChunks, toPgVector } from '@/lib/embeddings/embed';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let payload: { query?: string; limit?: number };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const query = (payload?.query ?? '').toString().trim();
  const limit = Math.max(1, Math.min(50, Number(payload?.limit ?? 5)));
  if (!query) {
    return NextResponse.json({ error: 'empty_query' }, { status: 400 });
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

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const [vec] = await embedChunks([query]);
  if (!vec) {
    return NextResponse.json({ results: [] });
  }

  const { data, error } = await supabase.rpc('match_kb_items', {
    query_embedding: toPgVector(vec),
    match_count: limit,
  });
  if (error) {
    return NextResponse.json(
      { error: 'search_failed', detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ results: data ?? [] });
}
