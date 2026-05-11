/**
 * classify edge function — Anthropic Claude Haiku 4.5.
 * Pulls unclassified email_messages, asks Claude for a category,
 * writes back category + category_confidence. pg_cron every 1 min.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VALID = [
  "sales","support","invoice","complaint","meeting","investor","urgent","escalation","spam","faq","other",
] as const;

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL         = Deno.env.get("CLASSIFY_MODEL") ?? "claude-haiku-4-5";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function extractJson(s: string): { category: string; confidence: number } {
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no json in response");
  const p = JSON.parse(m[0]);
  return {
    category: VALID.includes(p.category) ? p.category : "other",
    confidence: typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : 0,
  };
}

async function classifyOne(subject: string | null, preview: string | null, from: string | null) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 80,
      system: `You categorize inbound emails. Output ONLY JSON: {"category":"<${VALID.join("|")}>","confidence":0..1}. No prose.`,
      messages: [{ role: "user", content: JSON.stringify({ from, subject: subject ?? "", preview: preview ?? "" }) }],
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
  const limit = Math.min(50, Math.max(1, body.limit ?? 25));

  const { data: rows, error } = await supabase
    .from("email_messages")
    .select("id, subject, body_preview, from_addr")
    .is("category", null)
    .eq("is_outbound", false)
    .order("received_at", { ascending: false })
    .limit(limit);

  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  const out = { ok: true, scanned: rows?.length ?? 0, classified: 0, failed: 0, errors: [] as string[] };
  for (const r of rows ?? []) {
    try {
      const { category, confidence } = await classifyOne(r.subject, r.body_preview, r.from_addr);
      const { error: updErr } = await supabase
        .from("email_messages")
        .update({ category, category_confidence: confidence })
        .eq("id", r.id);
      if (updErr) throw new Error(`update: ${updErr.message}`);
      out.classified += 1;
    } catch (e) {
      out.failed += 1;
      out.errors.push(`${(r.id as string).slice(0, 8)}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
