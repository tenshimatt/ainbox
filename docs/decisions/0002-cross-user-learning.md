# ADR 0002 — Cross-user heuristic learning

**Status:** Proposed (PENDING DECISION — do not implement)
**Date raised:** 2026-05-13
**Raised by:** Samuel Leach (product call w/ Matt)
**Affects:** PRD §9.1, §4.1, §6, §13.1

## Context

In the 2026-05-13 pricing/free-trial discussion, Samuel proposed that
the AI's draft-quality heuristics should learn across all users, not
just one:

> "It will then actually run a different set of batch jobs in the
> background that builds a separate database that can be used for
> everybody. … It learns heuristically about everyone's inputs."

The current PRD makes this explicitly forbidden:

- **§9.1** — Cross-tenant aggregation, even anonymised, is forbidden in v1.
- **§4.1** — Every query filters by `auth.uid()`; no cross-tenant
  data flow.
- **§13.1** — Email PII breach is the highest-impact risk.

This ADR captures the tension and forces a deliberate decision before
any code change.

## Options

### Option A — Keep §9.1 as is (status quo)
Each tenant's L1–L5 personalisation stays within their own `user_id`.
No cross-tenant learning, ever.

- **Pros:** Zero PII leak risk. Simpler GDPR posture. Matches family-
  office data-sovereignty pitch from the same call.
- **Cons:** Slower personalisation cold-start for new users. No
  "wisdom of the crowd" on hard categories (e.g. detecting bulk
  newsletters that aren't on a hardcoded list).

### Option B — Anonymised heuristics only
A separate `global_heuristics` table stores ONLY: derived features
(e.g. "subject contains 'unsubscribe'" → category prior), not raw
content. Per-row provenance is dropped; only counts + outcome stats.

- **Pros:** Some cross-user signal without raw PII.
- **Cons:** Still a cross-tenant flow — even feature derivation can
  leak (e.g. unique subject patterns can fingerprint a user). Needs a
  privacy review and likely a DPIA. Reverses §9.1 in spirit.

### Option C — Opt-in pooled learning
Users explicitly tick "help improve Ainbox by contributing anonymised
patterns from my approve/reject decisions". Pooled data lives only
for opted-in users.

- **Pros:** Explicit consent satisfies GDPR Art.6(1)(a). Still gives
  optionality for the cohort that doesn't care.
- **Cons:** Adoption likely low → small sample. Adds a UI surface +
  consent record. Doesn't unblock the cold-start problem for
  privacy-conscious users (who are the target ICP).

## Recommendation

Defer the decision until at least 50 paying tenants are live.
Cold-start data sparseness is theoretical right now (we have 1 real
user); a cross-tenant database adds risk + regulatory cost that
exceeds the value at our current scale.

If a decision must be made for the July launch pitch deck, prefer
**Option C** — opt-in pooling lets us answer "yes, we can pool when
the user consents" to investors without breaking §9.1 for the default
case.

## Decision

⚠ **Not yet decided.** Until this ADR is moved to *Accepted*, code
that aggregates across `user_id` boundaries is blocked by the existing
§9.1 rule.

## Consequences

- The "build a model for everybody" line from the call cannot be
  implemented yet.
- A Plane ticket will exist as a doc-only placeholder until this is
  resolved.
- Investor pitch should describe this as "opt-in pooled learning,
  privacy-by-default" rather than "we learn across all users".
