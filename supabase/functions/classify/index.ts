/**
 * classify edge function — streamlined for demo.
 * Pulls unclassified email_messages, asks LiteLLM (DeepSeek V4 Pro)
 * for a category, writes back category + category_confidence.
 * No email_queue middleware. pg_cron schedules invocation.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VALID = [
  "sales","support","invoice","complaint","meeting","investor","urgent","escalation","spam","faq","other",
] as const;

const LITELLM_URL  = Deno.env.get("LITELLM_BASE_URL") ?? "";
const LITELLM_KEY  = Deno.env.get("LITELLM_API_KEY")  ?? "";
const MODEL        = Deno.env.get("CLASSIFY_MODEL")   ?? "deepseek-v4-pro";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function classifyOne(subject: string | null, preview: string | null, from: string | null) {
  const messages = [
    { role: "system",
      content: `Return JSON {"category":"<${VALID.join("|")}>","confidence":0..1}. No prose.`,
    },
    { role: "user", content: JSON.stringify({ from, subject: subject ?? "", preview: preview ?? "" }) },
  ];
  const resp = await fetch(`${LITELLM_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LITELLM_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, response_format: { type: "json_object" }, temperature: 0 }),
  });
  if (!resp.ok) throw new Error(`litellm ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const raw = (await resp.json()).choices?.[0]?.message?.content ?? "{}";
  const p = JSON.parse(raw);
  return {
    category: VALID.includes(p.category) ? p.category : "other",
    confidence: typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : 0,
  };
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
      out.errors.push(`${(r.id as string).slice(0, 8)}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
