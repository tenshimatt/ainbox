# Ainbox — Architecture pyramid (L1–L5)

> Used by the Pandomagic classifier node to decide the workflow lane
> for an incoming feature request. Each level lists examples and the
> contract tests that MUST stay green for that level.

## L1 — Cosmetic
**Examples**: copy fix, image swap, footer text, version bump.
**Contracts**: smoke only.
**Lane**: `L1-cosmetic`.

## L2 — Minor (single component, no surface change)
**Examples**: one new state in an existing component, refactor of one
file, lint fix sweep, **simple edge function or API route that adds one
endpoint using existing patterns (no schema migration, no new tables)**.
**Contracts**: `tests/smoke/` + any L4 contract test the file touches.
**Lane**: `L2-minor`.

## L3 — Major (cross-cutting, multiple files)
**Examples**: a new feature page, complex edge function with multiple
endpoints and schema migration, multiple new tables or RLS policies.
**Contracts**: `tests/smoke/` + ALL L4 contract tests + feature tests.
**Lane**: `L3-major`.

## L4 — Architecture contract
**Contracts the harness MUST not break:**

| ID | Contract | Test path |
|---|---|---|
| C-1 | Tenant isolation: every query filters by `auth.uid()` | `tests/contracts/c1-tenant-isolation.spec.ts` |
| C-2 | OAuth tokens never persisted in plaintext | `tests/contracts/c2-oauth-encrypted.spec.ts` |
| C-3 | Email body never appears in logs / observability | `tests/contracts/c3-pii-redaction.spec.ts` |
| C-4 | Auto-send confidence floor = 0.85 | `tests/contracts/c4-confidence-floor.spec.ts` |
| C-5 | No service-role calls in user-facing endpoints | `tests/contracts/c5-no-service-role-userside.spec.ts` |
| C-6 | Mobile-first: 375px viewport renders without overflow | `tests/contracts/c6-mobile-no-overflow.spec.ts` |
| C-7 | All authed pages wrap in `<AppLayout>` | `tests/contracts/c7-applayout-wrapping.spec.ts` |
| C-8 | Pre-commit fixture-PII check fires on real-looking emails | `tests/contracts/c8-fixture-pii-bounce.spec.ts` |

**Lane**: `L4-contract`. Contract test mandatory in same PR.

## L5 — Platform / infra
**Examples**: switch from Supabase to Neon, add new runtime, change
auth provider, replace embedding model dimension.
**Lane**: `L5-escalate`. Pandomagic halts; human ADR required in
`docs/decisions/`.
