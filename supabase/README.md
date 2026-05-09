# Ainbox — Supabase migrations

Schema lives in `supabase/migrations/`. PRD anchors: §4.1 (tenant
isolation), §4.2 (OAuth tokens), §4.3 (email content), §6.1 (data
inventory).

## Files

- `migrations/0001_init.sql` — initial schema. 7 tables, RLS on every
  one, pgvector + pgcrypto extensions, audit log append-only.
- `seed.sql` — local-dev test data. Synthetic addresses only
  (`@ainbox.test`). Idempotent — skips if synthetic users absent.

## Run locally

```bash
# Install Supabase CLI: https://supabase.com/docs/guides/cli
brew install supabase/tap/supabase

# From repo root
supabase start                # boots local Postgres + Auth + Studio
supabase db reset             # applies migrations + seed.sql

# Studio: http://localhost:54323
# DB:     postgresql://postgres:postgres@localhost:54322/postgres
```

## Run against ainbox-prod

The dark-factory does NOT push migrations directly. Workflow:

1. PR merged into `main` (this repo).
2. GitHub Actions (`.github/workflows/db-migrate.yml`, separate ticket)
   diffs `supabase/migrations/` against the deployed schema.
3. On a manual `workflow_dispatch`, applies pending migrations to
   `ainbox-prod` using the project's service-role connection string
   stored in GH Secrets.

No service-role calls run inside user-facing edge functions — see
PRD §4.1.

## Encryption notes (PRD §4.2, §4.3)

- `oauth_tokens.encrypted_refresh_token` is application-encrypted
  before insert (via Supabase Vault / `pgsodium`) by the edge function.
  Plaintext refresh tokens never enter the request handler.
- `email_messages.body_encrypted` + `body_iv` are AES-GCM ciphertexts
  produced inside the edge function. The DB never sees plaintext bodies.
- Both are gated additionally by RLS on `user_id` so even the
  ciphertext is invisible cross-tenant.

## Threshold floor

`automation_config.threshold >= 0.85` is enforced by a check
constraint, mirroring the mission/PRD §4.4 anti-pattern. Users may
raise the threshold but cannot lower it below 0.85.
