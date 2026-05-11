/**
 * draft edge function — Anthropic Claude Sonnet 4.6.
 * Selects classified inbound messages without a draft, generates a
 * reply, inserts into drafts. pg_cron every 2 min.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL         = Deno.env.get("DRAFT_MODEL") ?? "claude-sonnet-4-6";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function extractJson(s: string): { reply: string; confidence: number } {
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no json in response");
  const p = JSON.parse(m[0]);
  return {
    reply: typeof p.reply === "string" ? p.reply : "",
    confidence: typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : 0,
  };
}

async function generateReply(subject: string | null, preview: string | null, from: string | null, category: string | null) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system:
        'Write a concise professional reply (80-150 words). Output ONLY JSON: ' +
        '{"reply":"<text>","confidence":0..1}. No prose outside the JSON.',
      messages: [{ role: "user", content: JSON.stringify({ from, subject: subject ?? "", preview: preview ?? "", category }) }],
    }),
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`anthropic ${resp.status}: ${txt.slice(0, 300)}`);
  const data = JSON.parse(txt);
  const text = data.content?.[0]?.text ?? "";
  return extractJson(text);
}

serve(async (req: Request) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const limit = Math.min(25, Math.max(1, body.limit ?? 10));

  // Anti-join: pull the email_ids that already have a draft, then exclude.
  const { data: drafted } = await supabase.from("drafts").select("email_id");
  const draftedIds = (drafted ?? []).map((d) => d.email_id).filter(Boolean);

  let q = supabase
    .from("email_messages")
    .select("id, user_id, subject, body_preview, from_addr, category, category_confidence")
    .not("category", "is", null)
    .eq("is_outbound", false)
    .neq("category", "spam") // don't waste tokens drafting replies to spam
    .order("received_at", { ascending: false })
    .limit(limit);
  if (draftedIds.length > 0) {
    q = q.not("id", "in", `(${draftedIds.join(",")})`);
  }
  const { data: candidates, error } = await q;
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });

  const out = { ok: true, candidates: (candidates ?? []).length, drafted: 0, failed: 0, errors: [] as string[] };
  for (const r of candidates ?? []) {
    try {
      const { reply, confidence } = await generateReply(r.subject, r.body_preview, r.from_addr, r.category);
      if (!reply) throw new Error("empty reply");
      const { error: insErr } = await supabase.from("drafts").insert({
        user_id: r.user_id,
        email_id: r.id,
        reply_body: reply,
        confidence,
        status: "pending",
        model: MODEL,
      });
      if (insErr) throw new Error(`insert: ${insErr.message}`);
      out.drafted += 1;
    } catch (e) {
      out.failed += 1;
      out.errors.push(`${(r.id as string).slice(0, 8)}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
