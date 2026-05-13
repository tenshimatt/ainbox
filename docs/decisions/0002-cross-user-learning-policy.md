# 0002 — Cross-user learning policy

**Status:** Accepted  
**Date:** 2026-05-13  
**Ticket:** AINBOX-61  
**PRD anchor:** §9.1

---

## Context

As the knowledge base (KB) grows, a natural product question arises:
should Ainbox ever train on, aggregate, or surface knowledge *across*
user tenants — for example to pre-warm a new user's KB with common
industry answers, or to improve classification using patterns observed
across many inboxes?

The PRD explicitly forbids cross-tenant aggregation in v1 (§9.1) and
the CLAUDE.md architecture contract requires every query to filter by
`auth.uid()` with RLS enforced on every table. However neither document
records *why* that decision was made or whether any lightweight form of
cross-user learning could be acceptable in a future version.

This ADR captures the full reasoning so it can be revisited deliberately
rather than by accident.

---

## Decision

**No cross-user learning of any kind in v1. The boundary is hard.**

Specifically:

1. **No aggregated model fine-tuning.** User email content, KB entries,
   classification labels, and draft quality signals may not be used to
   fine-tune or prompt-engineer a shared model that benefits other tenants.

2. **No anonymised corpus sharing.** Even stripped of identifiers, email
   content reflects confidential business communication. Aggregating it
   — even for research — is outside the consent users gave at sign-up.

3. **No shared global KB.** Every KB entry is scoped to the tenant that
   created it. pgvector similarity search always includes the
   `tenant_id = auth.uid()` filter; this is enforced at the RLS layer,
   not just at the application layer.

4. **No implicit "industry template" seeding from real user data.** If
   we ever ship pre-warmed KB templates (a backlog idea), those templates
   must be written by Ainbox staff, not derived from any real user's data.

5. **Opt-in federated signals are out-of-scope for v1.** Even a
   voluntary "contribute my anonymised category labels to improve the
   classifier" feature introduces consent-flow complexity and audit
   obligations that are not appropriate before product-market fit.

---

## Rationale

### Tenant data is confidential business communication

Estate agents, mortgage brokers, and accountants (§2.1 ICPs) exchange
commercially sensitive and regulated information over email. Their
clients did not consent to that content being used to train any AI
system. Processing it under an implicit "product improvement" basis
would be inconsistent with UK GDPR legitimate-interest grounds given
the sensitivity of the data category.

### RLS is the enforcement mechanism, not application logic

The architecture enforces tenant isolation at the Postgres RLS layer.
Any cross-tenant query would require either:
- a service-role Supabase call (forbidden by §9.4 for user-facing paths), or
- a privileged background job with explicit purpose limitation.

Both paths require separate consent infrastructure that does not exist
in v1.

### The MVP value proposition does not require cross-user learning

The core claim is that Ainbox learns *your* voice from *your* inbox.
Cross-user learning undermines that narrative and introduces a liability
(data breach = many tenants' data exposed) for no MVP-stage benefit.

### Team mode (§12.8) is the right future surface

When multiple users share an organisation tenant, shared KB is natural
and consent is scoped to the same organisation. That feature already
exists on the roadmap. Implementing shared KB inside a single
organisation's tenant is architecturally clean; leaking across
organisations is not.

---

## Consequences

- **Positive:** Clear legal basis. RLS remains the sole enforcement
  point. No consent infrastructure needed. Simpler audit trail.
- **Positive:** Competitive differentiation — "your data never trains
  anyone else's AI" is a genuine selling point to regulated ICPs.
- **Negative:** No network effect on KB quality. Each user starts from
  scratch. Mitigated by Ainbox-authored industry templates in backlog.
- **Negative:** Classification model cannot benefit from observed
  label corrections across tenants. Mitigated by periodic Ainbox-side
  evaluation on synthetic or consented data in a separate research
  environment.

---

## Revisitation criteria

This ADR should be revisited if:

1. A tenant explicitly opts into contributing anonymised signals AND
   legal confirms a compliant consent mechanism.
2. Team mode (§12.8) ships and we need to define the within-org
   shared-KB boundary more precisely.
3. A regulatory change (e.g. ICO guidance on AI training) alters the
   legitimate-interest analysis.

Any revisitation must produce a new ADR (0003+) and update §9.1 of
the PRD. It must not be implemented as an unreviewed code change.
