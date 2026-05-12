/**
 * kb-extract edge function — Anthropic Claude Sonnet 4.6.
 * Mines sent mail for durable KB items, upserts kb_items. pg_cron every 5 min.
 *
 * AINBOX-51: Before inserting, compute the item's embedding via LiteLLM and
 * call kb_near_duplicate_exists. If an item of the same kb_type with cosine
 * similarity >= 0.9 already exists, skip the insert. Gracefully degrades
 * to exact-content dedup (via upsert conflict) when LITELLM_API_KEY is unset.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_KEY  = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL          = Deno.env.get("KB_MODEL") ?? "claude-sonnet-4-6";
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LITELLM_BASE   = Deno.env.get("LITELLM_BASE_URL") ?? "https://ai-gateway.beyondpandora.com/v1";
const LITELLM_KEY    = Deno.env.get("LITELLM_API_KEY") ?? "";
const EMBED_MODEL    = Deno.env.get("LITELLM_EMBEDDING_MODEL") ?? "bge-m3";
const DEDUP_THRESHOLD = 0.9;
const EMBED_DIM       = 1024;

const VALID_TYPES = ["faq","policy","pricing","preference","contact","signature","tone-sample"] as const;

async function mine(samples: Array<{ subject: string | null; preview: string | null }>) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system:
        "From the user's sent-email samples, extract up to 8 durable KB facts the writer would want re-used. " +
        `Each fact has a kb_type from ${VALID_TYPES.join("|")} and a short content sentence. ` +
        'Output ONLY JSON: {"items":[{"kb_type":"...","content":"...","confidence":0..1}]}. No prose.',
      messages: [{ role: "user", content: JSON.stringify(samples) }],
    }),
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`anthropic ${resp.status}: ${txt.slice(0, 300)}`);
  const data = JSON.parse(txt);
  const text = data.content?.[0]?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  const p = JSON.parse(m[0]);
  return Array.isArray(p.items) ? p.items : [];
}

/**
 * Get a 1024-dim embedding from LiteLLM for a single text string.
 * Returns null if LITELLM_API_KEY is unset or the request fails,
 * so the caller can degrade gracefully.
 */
async function embedText(text: string): Promise<number[] | null> {
  if (!LITELLM_KEY) return null;
  try {
    const resp = await fetch(`${LITELLM_BASE.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LITELLM_KEY}`,
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: [text] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const vec: unknown = json?.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBED_DIM) return null;
    return vec as number[];
  } catch {
    return null;
  }
}

serve(async (req: Request) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const userId: string | undefined = body.user_id;

  let users: string[] = [];
  if (userId) users = [userId];
  else {
    const { data } = await supabase
      .from("email_messages")
      .select("user_id")
      .eq("is_outbound", true);
    users = Array.from(new Set((data ?? []).map((r) => r.user_id)));
  }

  const out = { ok: true, users: users.length, extracted: 0, skipped: 0, errors: [] as string[] };
  for (const uid of users) {
    try {
      const { data: sent } = await supabase
        .from("email_messages")
        .select("subject, body_preview")
        .eq("user_id", uid)
        .eq("is_outbound", true)
        .order("received_at", { ascending: false })
        .limit(50);
      if (!sent || sent.length === 0) continue;
      const items = await mine(sent.map((s) => ({ subject: s.subject, preview: s.body_preview })));
      for (const it of items) {
        if (!VALID_TYPES.includes(it.kb_type) || typeof it.content !== "string" || !it.content.trim()) continue;

        // AINBOX-51: semantic near-duplicate guard (cosine >= 0.9, same kb_type)
        const embedding = await embedText(it.content);
        if (embedding !== null) {
          const { data: isDup } = await supabase.rpc("kb_near_duplicate_exists", {
            p_user_id:   uid,
            p_kb_type:   it.kb_type,
            p_embedding: `[${embedding.join(",")}]`,
            p_threshold: DEDUP_THRESHOLD,
          });
          if (isDup) {
            out.skipped += 1;
            continue;
          }
        }

        const { error } = await supabase.from("kb_items").upsert(
          {
            user_id:    uid,
            kb_type:    it.kb_type,
            content:    it.content,
            confidence: typeof it.confidence === "number" ? it.confidence : 0.5,
            verified:   false,
            // store the embedding we already computed so we don't re-embed later
            ...(embedding ? { embedding: `[${embedding.join(",")}]` } : {}),
          },
          { onConflict: "user_id,kb_type,content" },
        );
        if (!error) out.extracted += 1;
      }
    } catch (e) {
      out.errors.push(`${uid.slice(0, 8)}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
