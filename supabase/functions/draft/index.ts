/**
 * draft edge function — streamlined for demo.
 * Selects classified inbound messages that don't yet have a draft,
 * asks LiteLLM to produce a reply, inserts into drafts table.
 * pg_cron schedules invocation.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LITELLM_URL  = Deno.env.get("LITELLM_BASE_URL") ?? "";
const LITELLM_KEY  = Deno.env.get("LITELLM_API_KEY")  ?? "";
const MODEL        = Deno.env.get("CLASSIFY_MODEL")   ?? "deepseek-v4-pro";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function generateReply(subject: string | null, preview: string | null, from: string | null, category: string | null) {
  const messages = [
    { role: "system",
      content:
        "You write concise, helpful reply drafts. Match the tone of typical professional email. " +
        "Return JSON {\"reply\":\"<your reply text, ~80-150 words>\",\"confidence\":0..1,\"reason\":\"<one line on confidence>\"}. No prose.",
    },
    { role: "user", content: JSON.stringify({ from, subject: subject ?? "", preview: preview ?? "", category }) },
  ];
  const resp = await fetch(`${LITELLM_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LITELLM_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, response_format: { type: "json_object" }, temperature: 0.4 }),
  });
  if (!resp.ok) throw new Error(`litellm ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const raw = (await resp.json()).choices?.[0]?.message?.content ?? "{}";
  const p = JSON.parse(raw);
  return {
    reply: typeof p.reply === "string" ? p.reply : "",
    confidence: typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : 0,
  };
}

serve(async (req: Request) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const limit = Math.min(25, Math.max(1, body.limit ?? 10));

  // Pull classified inbound messages that don't yet have a draft.
  const { data: rows, error } = await supabase
    .from("email_messages")
    .select("id, user_id, subject, body_preview, from_addr, category")
    .not("category", "is", null)
    .eq("is_outbound", false)
    .order("received_at", { ascending: false })
    .limit(limit * 4); // over-fetch since we'll filter

  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });

  // Skip emails that already have a draft.
  const { data: existingDrafts } = await supabase
    .from("drafts")
    .select("email_id");
  const haveDraft = new Set((existingDrafts ?? []).map((d) => d.email_id));
  const candidates = (rows ?? []).filter((r) => !haveDraft.has(r.id)).slice(0, limit);

  const out = { ok: true, candidates: candidates.length, drafted: 0, failed: 0, errors: [] as string[] };
  for (const r of candidates) {
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
      out.errors.push(`${(r.id as string).slice(0, 8)}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
