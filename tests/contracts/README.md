# L4 Architecture Contract Tests

> These tests enforce architectural invariants that the pipeline
> MUST NOT break. Every PR touching `src/` must pass all L4 contracts
> relevant to the changed files.

## The 8 Contracts

| ID | Contract | File | Type | What it checks |
|---|---|---|---|---|
| **C-1** | Tenant isolation | `c1-tenant-isolation.spec.ts` | Static + Browser | RLS on every table, no service-role in API routes |
| **C-2** | OAuth tokens encrypted | `c2-oauth-encrypted.spec.ts` | Static + Browser | Vault/pgcrypto in migration, no tokens in HTML |
| **C-3** | PII redaction | `c3-pii-redaction.spec.ts` | Static + Browser | No body logging, synthetic fixtures, redaction helper |
| **C-4** | Confidence floor | `c4-confidence-floor.spec.ts` | Static + Browser | Constant ≥ 0.85, formula `min()`, UI enforcement |
| **C-5** | No service-role in user code | `c5-no-service-role-userside.spec.ts` | Static | API routes use anon key, service-role isolated |
| **C-6** | Mobile 375px no overflow | `c6-mobile-no-overflow.spec.ts` | Browser | Every page renders at 375px without overflow |
| **C-7** | AppLayout wrapping | `c7-applayout-wrapping.spec.ts` | Browser + Static | Sidebar + header on every authed page |
| **C-8** | Fixture PII bounce | `c8-fixture-pii-bounce.spec.ts` | Static | No real-looking emails in fixtures |

## How to run

```bash
# All contract tests
npx playwright test tests/contracts/

# Single contract
npx playwright test tests/contracts/c1-tenant-isolation.spec.ts

# With specific browser
npx playwright test tests/contracts/ --project=desktop-chrome

# Mobile tests
npx playwright test tests/contracts/c6-mobile-no-overflow.spec.ts --project=iphone-15
```

## Adding a new contract

1. Create `tests/contracts/c{id}-{slug}.spec.ts`
2. Update `docs/architecture/levels.md` with the new row
3. Update this README
4. Tag the test with `@contract` in the `test.describe` name

## Note

Some tests emit warnings (⚠️) when run against stub/mock code. This is
expected during MVP — the warnings flag things that need implementation
before the real backend is connected. The tests only **fail** on actual
violations.
