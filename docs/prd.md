# Ainbox — Product Requirements Document

> **Anchor document.** Every Plane ticket, ADR, plan, and PR cites a
> stable `§X.Y` from this file. Adding/removing sections is a breaking
> change to the audit trail — bump the `Last reviewed` date.

**Version:** 0.1 · MVP scope locked
**Last reviewed:** 2026-05-08

---

## §1 Vision

### §1.1 What we're building
An AI-powered email operations platform that connects to Gmail / Outlook
inboxes, ingests communication history, builds a contextual knowledge
base in a vector store, classifies inbound email, and drafts replies in
the user's own voice — gated by confidence scoring and human approval.

### §1.2 Why
Founders, SMEs, and operationally heavy roles (estate agents, brokers,
recruiters, accountants) lose 2–6 hours per day to email triage and
repetitive replies. Existing AI tools are generic, lack memory of
business context, and cannot safely automate replies. Ainbox closes
that gap with a *learned* assistant that's tied to a single user's
inbox, knowledge, and tone.

### §1.3 Success criteria for MVP
- A user can connect Gmail OR Outlook in <2 minutes
- Within 30 minutes of connection, Ainbox has ingested the last 1,000 emails and produced a usable knowledge base
- 80%+ of repetitive inbound enquiries (sales, support, FAQ-style) get high-confidence drafts
- The user reports saving ≥1 hour/day in week 2 of use
- Zero email PII leaves the user's tenant boundary in any logs, fixtures, or aggregated data

---

## §2 Target users

### §2.1 Primary ICPs
- Founders and solo operators
- Estate agents and lettings managers
- Mortgage brokers and protection advisers
- Recruiters and search consultants
- Accountants and bookkeepers
- Property businesses (development, holding, services)

### §2.2 Secondary ICPs
- Investor relations teams
- Law firms (transactional, repetitive matters)
- Financial advisers
- Executive assistants on behalf of execs
- Boutique agencies (PR, marketing, design)

### §2.3 Hard non-users (out-of-scope)
- Marketing teams running outbound blasts
- Anyone wanting "ChatGPT for my inbox" with no business memory
- Users who want auto-send at low confidence (rejected at config time)

---

## §3 Tech stack (locked — see §4 contract)

| Layer | Tech | Version pin |
|---|---|---|
| §3.1 Framework | Next.js 15 + React 19 + TypeScript 5.6 | `next@15`, `react@19` |
| §3.2 UI kit | shadcn/ui + Tailwind v3 | latest registry version |
| §3.3 Backend | Supabase (Postgres 15 + Auth + Storage + Edge Functions + RLS + pgvector) | project `ainbox-prod` (TBD) |
| §3.4 Vector DB | pgvector (1024-dim, cosine similarity) | bundled with §3.3 |
| §3.5 AI gateway | LiteLLM at `ai-gateway.beyondpandora.com` | virtual key per tenant (TBD) |
| §3.6 Drafting model | DeepSeek V4 Pro (default) | via §3.5 |
| §3.7 Embeddings | Ollama `bge-m3` (1024-dim) | via §3.5 |
| §3.8 Email APIs | Gmail (`googleapis@^140`) + MS Graph (`@microsoft/microsoft-graph-client@^3`) | locked majors |
| §3.9 Auth | Supabase Auth + Google OAuth + Microsoft OAuth (with email scopes) | single provider |
| §3.10 Background jobs | Supabase Edge Functions + pg_cron | no external queue in MVP |
| §3.11 Deployment | Vercel + Supabase + GitHub Actions | matches Rawgle pattern |
| §3.12 Testing | Playwright (e2e + smoke + contract) | tests/{smoke,contracts,features,regressions} |
| §3.13 Pentesting | Kali on CT 157 (10.90.10.57) | manual milestone passes |

Stack changes require an ADR in `docs/decisions/`.

---

## §4 Architecture contract

### §4.1 Tenant isolation
Every table includes `user_id uuid not null references auth.users(id)`.
Every row-level policy filters on `auth.uid() = user_id`. No
service-role calls in user-facing edge functions. Cross-tenant queries
are forbidden in v1.

### §4.2 OAuth token storage
Refresh tokens stored in `oauth_tokens` table with column-level
encryption (Supabase Vault). Tokens never leave the edge function
boundary. Access tokens are minted from refresh tokens at request time
and never persisted.

### §4.3 Email content handling
- **In transit**: TLS only, no logging of bodies
- **At rest**: encrypted in `email_messages.body_encrypted` column
- **In memory**: decrypted only inside an edge function for the duration of one request
- **In logs/observability**: bodies redacted; only metadata (subject hash, length, sender domain) is observable
- **In fixtures**: synthesised content only; pre-commit hook bounces real-looking addresses

### §4.4 Confidence model
Each draft computes:
- `retrieval_score` = max cosine similarity from the KB to the inbound email
- `generation_score` = the model's self-rated confidence (prompted)
- `confidence` = `min(retrieval_score, generation_score)`
- Auto-send threshold (per category): user-configured, MUST be ≥ 0.85
- Below threshold: draft only, surfaces in approval queue

### §4.5 Component contracts
- `<AppLayout>` wraps every authenticated page (sidebar + topbar + main)
- `<EmailContext>` provides current user's inbox accounts + sync state
- `<KBContext>` provides knowledge-base ready state and metadata
- `<DraftQueue>` is the canonical pending-drafts list; no parallel implementations

### §4.6 Edge function naming
- `email-sync-{gmail,outlook}` — sync workers
- `kb-extract` — knowledge extraction over recent emails
- `kb-embed` — embedding worker
- `classify` — inbound classification
- `draft` — reply drafting
- `auto-send` — threshold-checked send executor

---

## §5 Pages / surfaces

### §5.1 Marketing site
- `/` landing
- `/pricing`
- `/security`
- `/legal/{terms,privacy,dpa}`

### §5.2 Onboarding
- `/connect` (provider chooser)
- `/connect/google/callback`
- `/connect/microsoft/callback`
- `/onboarding/sync` (progress)
- `/onboarding/kb-review` (user confirms extracted KB items)

### §5.3 App (authenticated)
- `/inbox` (live triage view + draft queue)
- `/drafts` (all pending + history)
- `/knowledge` (KB items, edit/promote/demote)
- `/automation` (per-category auto-send config)
- `/audit` (decisions log, exportable)
- `/settings` (account, providers, billing, security)

### §5.4 Admin (Ainbox internal)
- `/admin/health` — system health, queue depth, error rates (no tenant data shown)

---

## §6 Email PII + GDPR

### §6.1 Data inventory
| Class | Examples | Retention | Encryption |
|---|---|---|---|
| Inbound metadata | sender, subject hash, timestamp | 24 months | row-level |
| Inbound body | full email body | configurable: 30 / 90 / 365 / forever | column-level |
| Sent metadata | same | 24 months | row-level |
| Sent body | same | same as inbound | same |
| KB items | extracted FAQs, policies, pricing | until user deletes | column-level |
| OAuth tokens | refresh + scope + expiry | until user disconnects | Vault |
| Audit log | decision events (no body content) | 24 months | row-level |

### §6.2 Subject access requests
- 30-day SLA for user data export (machine-readable JSON)
- 30-day SLA for full delete (cascading across all tables + storage + vector index)
- Export and delete endpoints scoped by `auth.uid()`, no admin override

### §6.3 Sub-processors
- Supabase (storage + compute)
- Vercel (hosting)
- LiteLLM gateway (Beyond Pandora self-hosted)
- DeepSeek (model inference) — DPA on file before launch (TBD)
- Google / Microsoft (OAuth providers, source data)

### §6.4 Region
EU/UK only at MVP. Supabase project pinned to `eu-west-2` (London).

---

## §7 Features (MVP build queue)

> Each ticket cites the §7.x it implements.

### §7.1 Provider OAuth — Google
Connect Google account, request `gmail.readonly` + `gmail.modify` + `gmail.send` scopes. Store refresh token. Show connection state in `/settings/providers`.

### §7.2 Provider OAuth — Microsoft
Connect Microsoft 365 account, request `Mail.Read` + `Mail.Send` + `offline_access`. Store refresh token. Show connection state.

### §7.3 Email sync — Gmail backfill
On connection, queue a job that pulls last 1,000 messages (sent + received) via Gmail API. Persist metadata + encrypted body. Emit per-batch progress event. Resumable on failure.

### §7.4 Email sync — Outlook backfill
Same as §7.3 via MS Graph `/me/messages` with `$top=100` paging.

### §7.5 Email sync — incremental (delta)
After initial backfill, switch to delta-token sync (Graph) / history-id (Gmail). Run every 60s via pg_cron triggering edge function.

### §7.6 Knowledge extraction
Over the synced corpus, run an extraction prompt that pulls typed KB items: `faq`, `policy`, `pricing`, `preference`, `contact`, `signature`, `tone-sample`. Store in `kb_items` with confidence + source-email reference.

### §7.7 Knowledge review UI
At `/onboarding/kb-review`, surface extracted KB items grouped by type, ordered by confidence. User confirms / edits / discards each. Confirmed items get `verified=true`.

### §7.8 Embedding pipeline
For every confirmed KB item AND every email in the corpus, compute a 1024-dim embedding via Ollama `bge-m3` and store in pgvector. Re-embed on item edit.

### §7.9 Classification engine
On every new inbound email, run a classifier prompt that returns one of 10 categories: `sales`, `support`, `invoice`, `complaint`, `meeting`, `investor`, `urgent`, `escalation`, `spam`, `other`. Store on the email row.

### §7.10 Reply drafting
For every classified email (except `spam`/`escalation`/`urgent`), retrieve top-5 KB items by cosine similarity, build a context-rich prompt including 3 sample sent-emails for tone, generate a draft. Compute confidence per §4.4. Store as a Gmail/Outlook draft via the API + locally.

### §7.11 Approval queue UI
At `/drafts`, show pending drafts ordered by confidence DESC. Each has Approve / Edit / Reject buttons. Approve sends the draft. Edit opens an inline editor and re-saves. Reject deletes locally; if the draft was created at the provider, also delete it there.

### §7.12 Auto-send mode
At `/automation`, per category: toggle auto-send on/off, set confidence threshold (≥0.85). On a new draft above threshold for an enabled category, the auto-send executor sends after a 60-second cooling delay (during which the user can intercept from the inbox view).

### §7.13 Dashboard / inbox view
At `/inbox`, show latest 50 inbound + pending drafts + auto-send activity. Live updates via Supabase Realtime.

### §7.14 Audit log
At `/audit`, show every classify/draft/send decision with timestamp, model, confidence, KB items used. Exportable as CSV.

### §7.15 Provider disconnect + delete
At `/settings/providers`, disconnect button removes OAuth tokens. At `/settings/account`, delete-everything button cascades a user delete.

### §7.16 Onboarding completion email
On first KB build complete, email the user a summary of what was extracted.

### §7.17 Error handling & retries
Sync jobs on permanent failure (4xx) bubble to `/admin/health` for the user (per-tenant); transient (5xx, 429) retry with exponential backoff up to 6 attempts.

### §7.18 Rate-limit handling
Gmail API: 250 quota units/user/sec. MS Graph: 10k req/10min. Sync workers stay below by pacing.

### §7.19 Smoke/contract tests
Every feature ships with @smoke and L4 contract tests where applicable.

### §7.20 Production observability
Sentry (frontend) + Supabase logs (backend). PII redacted at log-emission.

---

## §8 Non-functional

### §8.1 Performance
- Dashboard p95 < 1.5s on 4G (375px viewport)
- Draft generation p95 < 8s end-to-end
- Backfill 1,000 emails ≤ 30 min on free LiteLLM tier

### §8.2 Privacy
- No third-party analytics by default
- Optional opt-in to anonymous usage telemetry (no email content, ever)

### §8.3 Accessibility
- WCAG 2.1 AA on all `/` and `/app/*` pages
- Keyboard navigation for the approval queue (j/k/a/r shortcuts)

### §8.4 Reliability
- 99.5% uptime target (commercially reasonable for MVP)
- Daily Supabase point-in-time backup; weekly cross-region copy

### §8.5 Cost
- Per-user $/month budget at MVP: ≤ $1.50 in inference + $0.30 in storage
- Auto-pause classification + drafting if a tenant exceeds $5/day

---

## §9 Anti-patterns — DO NOT INTRODUCE

### §9.1 Cross-tenant aggregation
Even anonymised. Forbidden in v1.

### §9.2 Auto-send below 0.85 confidence
Non-negotiable — even with explicit user opt-in.

### §9.3 Real email content in fixtures or logs
Pre-commit hook enforces.

### §9.4 Service-role Supabase usage in user-facing endpoints
All user-facing calls use the user's JWT.

### §9.5 Generic chat box / free-roaming AI
The AI only operates on the user's mailbox.

### §9.6 Refresh-token rotation handled in client
Server-only.

### §9.7 Vibe-coding without a test
Covered by `factory-rules.md` hard rule #2.

### §9.8 Marketing-email blast features
Explicit no.

### §9.9 Web3 / crypto / NFT integrations
Explicit no (Beyond Pandora portfolio rule).

### §9.10 Hardcoded model names in business logic
All model selection goes via the LiteLLM gateway routing.

---

## §10 Sibling projects

- **Rawgle** (`/Users/mattwright/pandora/rawgle`) — pet-feeding companion app. Reference implementation for the Pandomagic harness Ainbox is also using.
- **Hugh Manatee** — voice-first memory-capture iOS app. Uses similar Pandomagic conversion.
- **JWM (METTLE)** — shop-floor operating system on ERPNext. Different stack but same harness pattern.
- **Sovrein.AI demo stack** — 3xx CTs in `10.90.20.0/25`. Ainbox is NOT in the demo stack; it's its own commercial product.

---

## §11 Known issues / open items

### §11.1 LiteLLM virtual-key per-tenant model
Not yet decided whether each user gets their own LiteLLM virtual key (clean cost attribution, harder ops) or all users share a global key (simple ops, harder cost attribution). Backlog: §12.x.

### §11.2 DeepSeek DPA
Required before EU/UK production launch. Tracked separately.

### §11.3 Pentest cadence
Initial Kali pentest from CT 157 after first deploy; subsequently after every major release. Cadence formalisation: §12.x.

---

## §12 Backlog (post-MVP)

### §12.1 Calendar integration
Read-only at first (extract meeting requests into KB), then booking via Google Calendar / Microsoft Graph Calendar APIs.

### §12.2 CRM bridge
Extract contacts from inbox into a lightweight CRM table; future: webhook into HubSpot / Pipedrive.

### §12.3 Slack notifications
"Important email arrived" alerts in a chosen Slack channel.

### §12.4 Invoice chasing
Detect outstanding invoices in conversations, draft chase emails on a schedule.

### §12.5 Voice notes for replies
Speak a draft, AI cleans + sends.

### §12.6 WhatsApp / SMS bridges
Same approval-queue pattern, different channels.

### §12.7 Multi-mailbox per user
Connect multiple Gmail + Outlook accounts to one Ainbox tenant.

### §12.8 Team mode
Multiple users, shared KB, role-based approval.

### §12.9 Mobile native (iOS first)
Capacitor wrap of the Next.js app, with native push notifications.

### §12.10 Whitelabel / agency mode
Resell Ainbox under a partner brand.

---

## §13 Risks

### §13.1 Email PII breach
Highest-impact risk. Mitigations: §4.3, §6, §8.2, regular Kali pentest pass, no service-role exposure.

### §13.2 OAuth scope creep / consent fatigue
Users may not grant all scopes. Mitigation: incremental consent — request only `readonly` initially, escalate to `modify` and `send` when the user enables drafting / auto-send.

### §13.3 Classification false positives
A `sales` mis-classified as `spam` blocks a draft. Mitigation: surface category in the inbox view + allow user override; log overrides as KB feedback.

### §13.4 Auto-send sending wrong reply
Mitigations: 60-second cooling delay before send, confidence floor 0.85, per-category opt-in, hard daily auto-send cap.

### §13.5 Provider rate-limit lockout
Mitigation: pacing in sync workers, exponential backoff, surfacing "rate-limited" state to user with ETA.

### §13.6 Cost overrun on a per-tenant basis
Mitigation: $5/day per-tenant cap, $50/day global cap, both hard-halt on trip.

### §13.7 Model degradation
DeepSeek model deprecation breaks drafting. Mitigation: LiteLLM model abstraction, ADR-driven model swaps.

### §13.8 Supabase region outage
Mitigation: PITR + cross-region weekly backup, DNS failover plan documented post-MVP.

---

**End of PRD v0.1.** Updates flow through the workflow + bump `Last reviewed`.
