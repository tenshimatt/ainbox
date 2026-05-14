# TaskResponse — factory rules

> **Loaded into every Archon workflow context.** How the autonomous
> implement / review / merge process works for TaskResponse. Operating
> constraints, not product scope. Product scope is `mission.md`.

## Hard rules — NO EXCEPTIONS

1. **Every Plane ticket created by the workflow carries `PRD: §X.Y`** at
   the top of its description. The `plane-create-ticket.sh` script
   refuses to file a ticket without `prd_section`. This is the audit
   trail anchor. If a ticket has no `§` to cite, the WORK is wrong.

2. **Tests written BEFORE implementation.** For every Plane ticket, a
   Playwright spec is committed and verified RED before any
   implementation code is written. The implement-loop cannot edit test
   files.

3. **Three gates exist; in dark-factory mode they auto-approve.**
   `gate-prd`, `gate-plan`, `gate-pr` still execute as workflow nodes
   so the audit trail is preserved. They post a Plane comment and a
   Telegram alert, but do not block.

4. **Hard halts are NOT bypassable**, even in dark-factory mode:
   - mission-triage `out_of_scope` → halt + `archon-failed`
   - classifier returns `L5` → halt + ADR required
   - architect-review or security-review returns any `blocker` concern → halt
   - implement loop hits 25 cycles without green → halt + `archon-failed`
   - validate fails any L4 contract test → halt
   - $10 token spend per run → halt + alert
   - any script exits non-zero with `✗` → halt

5. **No code-only changes without a passing test** — no PR opens unless
   `bun x playwright test --grep @smoke` passes locally inside the
   workflow's worktree. CI re-runs on the PR.

6. **No commits to `main` except via PR.** The workflow always opens a
   PR; it does not push directly. Branch name is
   `archon/<feature-slug>`.

7. **Workflow-created PRs reference both Plane + PRD** in the body —
   `Plane tickets: TASKRESPONSE-N1, TASKRESPONSE-N2, ...` and `PRD: §X.Y`.

8. **Email PII boundary** — no test fixture, log line, or commit may
   contain real email content. Synthesised fixtures only. Pre-commit
   hook scans for `@` patterns in test data and bounces violations.

## Implementation conduct

- Single agent at a time on a given worktree. No parallel writes.
- Architecture-reviewer (Opus) + security-reviewer (DeepSeek-Pro) run
  **in parallel** during the plan phase, then merge into one gate-plan.
- Implement loop is bounded to **25 cycles** (test → code → test). If
  not green by then, the loop stops with `archon-failed` and surfaces
  the failure.
- The implement loop **cannot edit** files in `tests/`, `mission.md`,
  `factory-rules.md`, `CLAUDE.md`, or `docs/`. Those are spec, not code.
- The implement loop has Read/Write/Edit/Bash/Glob/Grep tools. No
  network calls except localhost and `bun install` (no curl-based
  data fetches; if a feature needs data, it goes through Supabase or
  a fixture file).

## Review conduct

- **Architect-reviewer** challenges the plan — DOES NOT co-sign. Outputs
  a list of concerns at severity blocker / major / minor. Empty list
  is acceptable; pretending to find issues is not.
- **Security-reviewer** focuses ONLY on email-PII handling, OAuth
  token storage, RLS, GDPR, BOLA, XSS, secrets, rate-limit. Does not
  opine on style.
- **Final-reviewer** (post-implement) checks: every concern raised
  pre-plan was addressed OR explicitly deferred to a follow-up Plane
  ticket. Email-PII concerns cannot be deferred.

## Merge conduct

- `gate-pr` posts a Plane comment + Telegram alert with the PR URL,
  then auto-approves after a 60-second cooling delay (gives the human
  a chance to `:reject:` if monitoring live).
- Auto-merge is NOT enabled. Human merges via GitHub UI after CI green.
  This is the ONLY remaining human gate in the chain — final shipping
  decision.

## Cost discipline

- Plan + worker nodes use DeepSeek V4 Pro via LiteLLM. Architect-review
  uses Opus 4.7. Implement uses Sonnet 4.6.
- A workflow run that exceeds **$10 in tokens** auto-halts and pages
  Matt via Telegram.
- A daily workflow-run total exceeding **$50** halts the poller until
  morning (`/etc/archon/poller.env DAILY_BUDGET=5000`).

## Logging + audit

- Every workflow run logs to `/var/log/archon/taskresponse-<ticket>.log` on CT 111.
- Every gate decision (auto-approve / halt + reason) is posted as a
  Plane comment so the audit trail stays in the ticket.
- The PR description summarises the full chain: PRD §, plan file,
  Plane tickets, test files, validation results, reviewer concerns.
- Telegram alerts are sent on: gate-prd, gate-plan, gate-pr, halt,
  PR open. Stored as a thread on Matt's DM (chat 374047225).

## Stop conditions

The workflow halts immediately and labels the ticket `archon-failed` if:
- Mission triage rejects (out-of-scope)
- Classifier returns L5 (platform-level change)
- Tests can't be made green within 25 implement cycles
- Architect or security review returns a `blocker`
- Final review verdict is `needs-changes` and there's no obvious fix
- Any script exits non-zero with a message starting `✗`
- Token spend exceeds $10/run

## When this file changes

Same governance as `mission.md`. Material edits → discussion → edit →
update memory file `archon_taskresponse_workflow.md` to match.

**Last reviewed: 2026-05-08**
