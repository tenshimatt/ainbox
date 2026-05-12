/**
 * draft edge function — Anthropic Claude Sonnet 4.6.
 *
 * Pulls draftable candidates via draftable_candidates() RPC (which already
 * applies L1.8 hard-skips + L1.10 thread-suppression), asks Claude for a
 * reply, then applies L1.9 soft signals + L1.11 name-match boost to the
 * model's raw confidence before persisting.
 *
 * pg_cron every 2 min.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL         = Deno.env.get("DRAFT_MODEL") ?? "claude-sonnet-4-6";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ReplyJson {
  reply: string;
  confidence: number;
  reason: string;
}

function extractJson(s: string): ReplyJson {
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no json in response");
  const p = JSON.parse(m[0]);
  return {
    reply: typeof p.reply === "string" ? p.reply : "",
    confidence: typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : 0,
    reason: typeof p.reason === "string" ? p.reason : "",
  };
}

async function generateReply(
  subject: string | null,
  preview: string | null,
  from: string | null,
  category: string | null,
  examples: Array<{ subject: string | null; reply_body: string | null }>,
  memories: Array<{ kind: string; signal: string }>,
): Promise<ReplyJson> {
  // L3 — few-shot: inject the user's most-recently-approved replies in this category.
  const examplesBlock =
    examples.length > 0
      ? "\\n\\nThe user's most recent approved replies in this category — match this voice, structure, and tone:\\n" +
        examples
          .map((e, i) => `[example ${i + 1}]\\nSubject: ${(e.subject ?? "").slice(0, 200)}\\nReply: ${(e.reply_body ?? "").slice(0, 600)}`)
          .join("\\n\\n")
      : "";
  // L1.5 — memory: things the user previously rejected; avoid repeating.
  const memoryBlock =
    memories.length > 0
      ? "\\n\\nAvoid these patterns the user has rejected before:\\n" +
        memories.slice(0, 10).map((m) => `- (${m.kind}) ${m.signal}`).join("\\n")
      : "";

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
        "You are drafting reply emails for a busy professional. " +
        "FIRST decide: does this email expect a human reply? " +
        "If it's an automated notification, transactional alert, marketing blast, " +
        "newsletter, or anything where replying is pointless, return " +
        '{"reply":null,"confidence":0,"reason":"<why>"}. ' +
        "Only when a real human reply is warranted, write a concise 60-120 word reply that: " +
        "(a) acknowledges the specific ask, (b) answers or commits to a next step, " +
        "(c) is natural and direct — no over-formal corporate filler. " +
        'Output ONLY JSON: {"reply":"<text or null>","confidence":0..1,"reason":"<short>"}. No prose.' +
        examplesBlock +
        memoryBlock,
      messages: [{ role: "user", content: JSON.stringify({ from, subject: subject ?? "", preview: preview ?? "", category }) }],
    }),
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`anthropic ${resp.status}: ${txt.slice(0, 300)}`);
  const data = JSON.parse(txt);
  return extractJson(data.content?.[0]?.text ?? "");
}

/**
 * L1.11 name-match: does the body greeting contain the user's first name?
 * Greedy regex on common greeting forms — Hi / Hey / Hello / Dear / Good morning, etc.
 */
function greetingMatchesName(preview: string | null, fullName: string | null): boolean {
  if (!preview || !fullName) return false;
  const first = fullName.trim().split(/\s+/)[0]?.toLowerCase();
  if (!first || first.length < 2) return false;
  const m = preview.match(/(?:^|\n|\s)(hi|hello|hey|dear|good (?:morning|afternoon|evening))[ ,]+([\w]+)/i);
  if (!m) return false;
  return m[2].toLowerCase() === first || m[2].toLowerCase() === fullName.toLowerCase();
}

/** L1.9 soft signals — additive, clamped to [0,1]. Returns adjusted confidence. */
function adjustConfidence(raw: number, signals: {
  greeting_name_match: boolean;
  body_has_question: boolean;
  is_re_thread: boolean;
  same_domain: boolean;
  first_time_sender: boolean;
  reply_to_differs: boolean;
}): number {
  let c = raw;
  if (signals.greeting_name_match) c += 0.20;
  if (signals.body_has_question)   c += 0.10;
  if (signals.is_re_thread)        c += 0.10;
  if (signals.same_domain)         c += 0.05;
  if (signals.first_time_sender)   c -= 0.10;
  if (signals.reply_to_differs)    c -= 0.10;
  return Math.max(0, Math.min(1, c));
}

function extractDomain(addr: string | null): string | null {
  if (!addr) return null;
  const m = addr.match(/@([\w.-]+)/);
  return m ? m[1].toLowerCase() : null;
}

serve(async (req: Request) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const limit = Math.min(25, Math.max(1, body.limit ?? 10));

  const { data: candidates, error } = await supabase.rpc("draftable_candidates", { p_limit: limit });
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });

  const out = { ok: true, candidates: (candidates ?? []).length, drafted: 0, skipped: 0, failed: 0, errors: [] as string[] };

  for (const r of candidates ?? []) {
    try {
      // Per-user profile lookup (name + email) for soft signals. Cache by user_id within this run.
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", r.user_id)
        .maybeSingle();
      const fullName = (profile as { full_name?: string } | null)?.full_name ?? null;
      const userEmail = (profile as { email?: string } | null)?.email ?? null;

      // Compute soft signals BEFORE the model call.
      const signals = {
        greeting_name_match: greetingMatchesName(r.body_preview, fullName),
        body_has_question:   /\?/.test(r.body_preview ?? ''),
        is_re_thread:        /^re:\s/i.test(r.subject ?? ''),
        same_domain:         !!(userEmail && extractDomain(r.from_addr) === extractDomain(userEmail)),
        first_time_sender:   false, // requires history lookup, skip for now
        reply_to_differs:    false, // requires reply_to vs from check, skip until we wire it through RPC
      };

      // L3 — pull few-shot examples (recent approved drafts in this category).
      const { data: examples } = await supabase.rpc("top_approved_for_category", {
        p_user_id: r.user_id, p_category: r.category, p_limit: 3,
      });
      // L1.5 — pull last 10 user_memory entries (lessons from rejections).
      const { data: memories } = await supabase
        .from("user_memory")
        .select("kind, signal")
        .eq("user_id", r.user_id)
        .order("created_at", { ascending: false })
        .limit(10);

      const { reply, confidence: rawConfidence, reason } = await generateReply(
        r.subject, r.body_preview, r.from_addr, r.category,
        (examples as Array<{ subject: string | null; reply_body: string | null }>) ?? [],
        (memories as Array<{ kind: string; signal: string }>) ?? [],
      );

      if (!reply || reply.trim() === "") {
        await supabase.from("drafts").insert({
          user_id: r.user_id,
          email_id: r.id,
          reply_body: `[no reply needed] ${reason}`.slice(0, 500),
          confidence: 0,
          status: "rejected",
          model: MODEL,
        });
        out.skipped += 1;
        continue;
      }

      const adjusted = adjustConfidence(rawConfidence, signals);
      const { error: insErr } = await supabase.from("drafts").insert({
        user_id: r.user_id,
        email_id: r.id,
        reply_body: reply,
        confidence: adjusted,
        generation_score: rawConfidence,
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
