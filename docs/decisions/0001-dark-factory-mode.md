# 0001 — Dark-factory mode for MVP build

**Status:** Accepted
**Date:** 2026-05-08

## Context

Pandomagic's three human gates (`prd`, `plan`, `pr`) exist to catch
scope and security mistakes before they ship. They cost human attention,
which is the bottleneck for MVP velocity.

For Ainbox MVP, Matt explicitly authorised running the harness in
**dark-factory mode**: gates auto-approve, halts still apply on hard
failures, security review will be revisited iteratively *with the
human* after each MVP milestone.

## Decision

- All three gates `gate-prd`, `gate-plan`, `gate-pr` auto-approve.
- The gate-pr node has a 60-second cooling delay during which a
  `:reject:` Plane comment OR a Telegram emergency-stop overrides.
- Hard halts remain non-bypassable:
  - mission-triage `out_of_scope`
  - classifier returns `L5`
  - architect-review or security-review returns any `blocker`
  - implement loop hits 25 cycles without green
  - any L4 contract test fails
  - $10 per-run token spend
  - $50 daily total spend
- Every halt and PR open posts to Plane and pings Matt's Telegram via `notify-tg.sh`.

## Consequences

- **Faster MVP delivery** (no waiting on Matt for gates).
- **Higher residual security risk** until the iterative review pass post-MVP.
- **Audit trail preserved**: gate nodes still execute and log; we know what we waved through.
- **Reversible**: flip `dark_factory.enabled: false` in `.archon/config.yaml` to restore approval gates.
