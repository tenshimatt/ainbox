# CLAUDE.md — Ainbox global rules

> Auto-loaded by Claude Code on every session in this repo. Also
> loaded into every Archon workflow context. Treat as ALWAYS-IN-EFFECT.

## What this repo is

The Ainbox source — AI inbox operations platform. Backend on Supabase
(Postgres + pgvector + Auth + Edge Functions). Frontend Next.js 15 on
Vercel. Email integrations via Gmail API + Microsoft Graph.

## Tech stack — DO NOT CHANGE WITHOUT AN ADR

| Layer | Tech | Locked because |
|---|---|---|
| Framework | Next.js 15 + React 19 + TypeScript 5.6 | Modern App Router, server actions, edge-friendly |
| UI | shadcn/ui (Radix) + Tailwind v3 | Matches existing Beyond Pandora projects |
| State | TanStack Query (server) + Zustand (client) + Context (auth) | Same pattern as Rawgle |
| Backend | Supabase project `ainbox-prod` (Postgres + Auth + Storage + Edge Functions + RLS + pgvector) | Single source of truth for all tenant data |
| Vector DB | pgvector via Supabase | Avoids second vendor; RLS extends to embeddings |
| AI | LiteLLM gateway (`ai-gateway.beyondpandora.com`) → DeepSeek V4 Pro (drafting) + Ollama embeddings (free, local) | Cost-controlled |
| Email APIs | Gmail (`@google-cloud/local-auth` + `googleapis`), Outlook (`@microsoft/microsoft-graph-client`) | Official SDKs, no DIY HTTP |
| Auth | Supabase Auth + Google OAuth + Microsoft OAuth (sign-in AND email-scope tokens) | Single auth provider |
| Background jobs | Supabase Edge Functions + pg_cron (sync, classify, draft) | Keep in-tenant; no external queue |
| Deployment | Vercel (Next.js) + Supabase (backend) + GitHub Actions (CI) | Pattern from Rawgle |
| Testing | Playwright (e2e + smoke + contract) | Tests in `tests/{smoke,contracts,features,regressions}` |
| Pentesting | Kali on CT 157 (10.90.10.57) — out-of-band, not on critical path | Manual passes after each MVP milestone |

If a change needs to deviate, write an ADR in `docs/decisions/` first.

## Architecture contract — must hold across every page

- **Tenant isolation**: every query filters by `auth.uid()`. Every
  table has RLS. No service-role usage in user-facing edge functions.
- **OAuth tokens**: stored encrypted in `oauth_tokens` table with
  per-row Postgres column encryption. Refresh tokens never leave the
  edge function boundary.
- **Email content**: never logged in plaintext. Bodies redacted in any
  observability output. Stored encrypted at rest, decrypted only in
  edge function memory for the duration of a single request.
- **Confidence threshold for auto-send**: hardcoded at 0.85 minimum.
  User can raise but not lower.
- **No cross-tenant data flow**: features that aggregate (e.g. global
  KB stats) are forbidden in v1.

## Hard rules

1. **Mobile-first.** Every dashboard page renders without horizontal
   overflow at 375px viewport. Enforced by Playwright smoke.
2. **No third-party analytics** without explicit user opt-in.
3. **No commits with secrets.** `.env.*` files are gitignored. OAuth
   client secrets live in Supabase secrets (server-side) and Vercel
   env (build-side). NEVER in repo.
4. **Tests required for new behaviour.** CI rejects PRs that change
   `src/` without a corresponding test file change.
5. **PRD anchor.** Every behavioural change must trace to a `§X.Y` in
   `docs/prd.md`. The Pandomagic harness enforces this for autonomous
   runs; manual commits should follow the same rule.
6. **No real email content in fixtures.** Pre-commit hook bounces any
   test fixture containing `@` patterns that look like real addresses.

## How work flows here

- **Idea → Plane ticket** (workspace `beyond-pandora`, project `ainbox`)
- **Plane label `archon-ready`** → 5-min poller on CT 111 picks it up
- **Workflow runs** in dark-factory mode: PRD edit → mission triage →
  classify → plan → architect-review (Opus) + security-review →
  BDATSI×6 diagrams → tests-first → implement (max 25 cycles) →
  validate → final-review → PR
- **Auto-approval** at all 3 gates (with 60s cooling at gate-pr)
- **Halts** post Telegram alert + Plane comment
- **PR opens** with full audit trail in description

Full ops doc: `Obsidian/PROJECTS/Ainbox/40-operations/archon-ainbox-workflow.md`

## Files I should always read

When entering this repo for any non-trivial task:

1. **This file** (`CLAUDE.md`) — global rules
2. **`mission.md`** — what the product is + scope boundaries
3. **`factory-rules.md`** — operating constraints for autonomous runs
4. **`docs/prd.md`** — the PRD with `§X.Y` anchors

For the specific feature being touched, also load:
`docs/architecture/<slug>.md` (and `<slug>.excalidraw` if a diagram exists).

## Project quirks I will likely trip over

- **Gmail API send vs draft** — drafting is a different scope; we use
  draft-create + draft-send to keep the auto-send revocable.
- **MS Graph delta queries** — sync uses `/me/messages/delta` with a
  delta token stored in `email_sync_state`. Don't refetch.
- **OAuth refresh** — Google rotates refresh tokens; MS Graph doesn't.
  Storage layer handles both.
- **pgvector dimension** — locked at 1024 (Ollama `bge-m3`). Switching
  embedding model requires a migration + re-embed of the corpus.
- **Confidence calculation** — `min(retrieval_score, generation_self_score)`
  per Pandomagic memory note. Don't average — minimum.
- **Dark factory** — gates auto-approve in this project, but the gate
  nodes still EXECUTE for audit. Don't remove them.

## Anti-patterns — DO NOT INTRODUCE

(From PRD §9. Listing here because the agent needs them in-context.)

1. **Aggregated cross-tenant insights** — even anonymised
2. **Auto-send below 0.85 confidence** — non-negotiable
3. **Real email content in fixtures or logs**
4. **Service-role Supabase calls in user-facing endpoints**
5. **Generic chat box** — the AI only operates on the user's mailbox
6. **Refresh-token rotation handled in client** — server-only
7. **Vibe-coding without a test** — covered by factory-rules.md hard rule #2
8. **Marketing-email blast features** — explicit no, scope drift

**Last reviewed: 2026-05-08**
