/**
 * kb-extract edge function — streamlined for demo.
 * Asks LiteLLM to mine recent sent emails for KB items (FAQ answers,
 * preferences, pricing nuggets) and upserts them into kb_items.
 *
 * Naive but effective: pulls last 100 sent messages, sends headers +
 * body_preview to the model, expects a JSON array of items back.
 *
 * pg_cron schedules invocation every 5 min.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LITELLM_URL  = Deno.env.get("LITELLM_BASE_URL") ?? "";
const LITELLM_KEY  = Deno.env.get("LITELLM_API_KEY")  ?? "";
const MODEL        = Deno.env.get("CLASSIFY_MODEL")   ?? "deepseek-v4-pro";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const VALID_TYPES = ["faq","policy","pricing","preference","contact","signature","tone-sample"] as const;

async function mine(samples: Array<{ subject: string | null; preview: string | null }>) {
  const messages = [
    { role: "system",
      content:
        "From the provided sent-email samples, extract durable KB facts the writer would want re-used in future replies. " +
        `Each fact has a kb_type from ${VALID_TYPES.join("|")} and a short content sentence. ` +
        "Return JSON {\"items\":[{\"kb_type\":\"...\",\"content\":\"...\",\"confidence\":0..1}]}. Up to 8 items, no duplicates. " +
        "If samples reveal nothing reusable, return {\"items\":[]}. No prose.",
    },
    { role: "user", content: JSON.stringify(samples) },
  ];
  const resp = await fetch(`${LITELLM_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LITELLM_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, response_format: { type: "json_object" }, temperature: 0.2 }),
  });
  if (!resp.ok) throw new Error(`litellm ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const raw = (await resp.json()).choices?.[0]?.message?.content ?? "{}";
  const p = JSON.parse(raw);
  return Array.isArray(p.items) ? p.items : [];
}

serve(async (req: Request) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const userId: string | undefined = body.user_id;

  // Get one or all users with sent mail.
  let users: string[] = [];
  if (userId) users = [userId];
  else {
    const { data } = await supabase
      .from("email_messages")
      .select("user_id")
      .eq("is_outbound", true);
    users = Array.from(new Set((data ?? []).map((r) => r.user_id)));
  }

  const out = { ok: true, users: users.length, extracted: 0, errors: [] as string[] };
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
        const { error } = await supabase.from("kb_items").upsert(
          {
            user_id: uid,
            kb_type: it.kb_type,
            content: it.content,
            confidence: typeof it.confidence === "number" ? it.confidence : 0.5,
            verified: false,
          },
          { onConflict: "user_id,kb_type,content" },
        );
        if (!error) out.extracted += 1;
      }
    } catch (e) {
      out.errors.push(`${uid.slice(0, 8)}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
