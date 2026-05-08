# Ainbox — Mission

> **Loaded into every Archon workflow context.** Don't bloat. If a thing
> doesn't help an autonomous agent decide whether to build something,
> it doesn't belong in this file. Detail goes in `docs/prd.md` (the PRD).

## What Ainbox is

Ainbox is an AI-powered email operations platform. It connects to a user's
Gmail or Outlook inbox, ingests recent communication history, builds a
contextual business knowledge base in a vector store, classifies inbound
email, and drafts replies in the user's own voice — gated by confidence
scoring and (optionally) human approval.

Positioning: **"a digital executive assistant that learns how you reply
and does it for you."**

## Who it's for

1. **Founders / SMEs / consultants** (primary) — drowning in repetitive email
2. **Estate agents, mortgage brokers, recruiters, accountants** — pattern-heavy reply workflows
3. **Property businesses** — lead enquiries with predictable shapes
4. **Investor relations / EAs** (secondary) — high-volume, brand-sensitive replies

## In scope (the factory will build these)

- **Inbox connection**: Gmail OAuth (Google APIs) + Microsoft 365 OAuth (MS Graph)
- **Historical ingestion**: last 1,000 emails per inbox, sent + received, with attachments deferred to v1.1
- **Knowledge base**: vector embeddings (pgvector on Supabase) of past replies, FAQs, pricing, policies, signature, tone — typed namespaces
- **Classification engine**: every inbound email tagged into 10+ categories (sales, support, invoice, complaint, meeting, investor, spam, urgent, escalation, other)
- **Reply drafting**: contextual, tone-matched drafts using LiteLLM gateway → DeepSeek/Claude
- **Confidence scoring**: high / medium / low on every draft, blocking auto-send below threshold
- **Approval surface**: dashboard with pending drafts queue; approve / edit / reject
- **Auto-send mode**: opt-in per category, only when confidence high and category whitelisted
- **Audit trail**: every draft + decision logged for compliance

## Out of scope (hard boundaries — factory must REFUSE)

- **Crypto / token economies / NFTs** — explicit no, multi-product rule
- **Generic chat** — the assistant only operates on the user's inbox; no free-roaming AI
- **Cross-tenant data sharing** — tenants are isolated end-to-end; no aggregated insights across users
- **Marketing email blast features** — Ainbox is for operations, not outbound marketing
- **Calendar booking / CRM-as-replacement** — hooks may be added (V2), but Ainbox is not a calendar or CRM
- **Voice/phone integrations** — V3 territory at earliest
- **Generative image / content tooling** unrelated to inbox replies
- **Auto-send at low confidence** — non-negotiable; even with explicit user opt-in, low-confidence drafts never auto-send
- **Storing decrypted email bodies outside the user's tenant** — encrypted at rest, scoped by user_id
- **Anything contradicting PRD §9 anti-patterns**

## Issue triage rules (Plane `archon-ready` label)

When a ticket is labelled `archon-ready`, the workflow's first AI step
checks it against this mission. The ticket is **rejected** if:

1. It requests an out-of-scope feature (above)
2. It contradicts the PRD anchor at `§X.Y` it cites
3. It can't be specified as a testable acceptance criterion (anti-pattern §9.x — vibe-coding without a test)
4. It would require breaking the architecture contract (PRD §4)
5. It would weaken the email-PII boundary without a reviewed ADR

Rejected tickets get the `archon-failed` label + a comment explaining why.

## Default model + cost expectations

- **Workflow nodes (worker)**: DeepSeek V4 Pro via LiteLLM gateway (cheap, capable)
- **Architect-review** (adversarial): Claude Opus 4.7 via Anthropic SDK — only node that gets Opus
- **Implement loop**: Claude Sonnet 4.6 (tool-use loop with Read/Write/Edit/Bash/Playwright)
- **Mission-triage / Plane-tickets / open-pr**: DeepSeek V4 Flash (mechanical)
- **Per-feature workflow run**: ~$2-5 in tokens
- **Per-run halt threshold**: $10 — auto-halt and Telegram ping
- **Model swaps require an ADR** in `docs/decisions/`

## Dark-factory mode

Ainbox runs in **dark-factory mode** by default: the three human gates
(`gate-prd`, `gate-plan`, `gate-pr`) auto-approve so the harness runs
end-to-end without human intervention. Hard failures still halt:
- Test suite red after 25 implement cycles
- Security-review returns any `blocker`-severity concern
- Classifier returns L5 (platform/infra change)
- Mission-triage rejects (out-of-scope)
- $10 token halt threshold tripped

Every halt and every PR open pings Matt's Telegram via `notify-tg.sh`.
First-pass security review will be revisited iteratively *with the
human* after the initial build is functional. This is documented and
intentional — see `docs/decisions/0001-dark-factory-mode.md`.

## When this file changes

Material edits go through:
1. Discussion via Plane ticket OR direct in a Claude Code session
2. Update this file
3. Update PRD `§1` / `§2` / `§9` to match
4. Bump `Last reviewed` date
5. `notify-tg.sh -e MISSION_CHANGED "..."` so Matt has an audit trail

**Last reviewed: 2026-05-08**
