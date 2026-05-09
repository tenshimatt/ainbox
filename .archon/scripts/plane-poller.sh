#!/usr/bin/env bash
# plane-poller.sh — runs every 5 min via systemd timer on CT 111.
#
# Polls Plane for tickets labelled `archon-ready` that don't yet have an
# `archon-running` or `archon-done` label. For each one:
#   1. Adds `archon-running` label (so the ticket isn't double-triggered)
#   2. Posts a "Workflow started" comment to the ticket
#   3. Kicks off the ainbox-feature workflow with the ticket id as input
#   4. Pipes workflow stdout/stderr to /var/log/archon/ainbox-<id>.log

set -euo pipefail
: "${PLANE_API_TOKEN:?PLANE_API_TOKEN required}"

PLANE_BASE="${PLANE_BASE:-https://plane.beyondpandora.com}"
WORKSPACE="${PLANE_WORKSPACE:-beyond-pandora}"
PROJECT_ID="${PLANE_PROJECT_ID:-f88111cd-cac2-4e9f-af38-2241e215c4ad}"

LABEL_READY="${LABEL_ARCHON_READY:?LABEL_ARCHON_READY env var required}"
LABEL_RUNNING="${LABEL_ARCHON_RUNNING:?LABEL_ARCHON_RUNNING env var required}"

LOG_DIR="${ARCHON_LOG_DIR:-/var/log/archon}"
mkdir -p "$LOG_DIR"

# Fetch tickets that have `archon-ready` and NOT `archon-running` / `archon-done`.
TICKETS="$(curl -fsS -H "x-api-key: $PLANE_API_TOKEN" \
  "${PLANE_BASE}/api/v1/workspaces/${WORKSPACE}/projects/${PROJECT_ID}/issues/?per_page=100" \
  | jq -r --arg ready "$LABEL_READY" --arg running "$LABEL_RUNNING" '
      .results[]
      | select( (.labels // []) | index($ready) )
      | select( ((.labels // []) | index($running)) == null )
      | .id')"

if [[ -z "$TICKETS" ]]; then
  exit 0
fi

# ─── CONCURRENCY GUARD ──────────────────────────────────────────────
# The Pandomagic harness has a per-workflow singleton lock — running a
# second `ainbox-feature` while another is in flight rejects with
# "Workflow already running". Skip this tick entirely if any
# ainbox-feature run is currently active on the harness.
HARNESS_URL="${ARCHON_HARNESS_URL:-http://10.90.10.56:3090}"
ACTIVE="$(curl -fsS --max-time 4 "${HARNESS_URL}/api/health" 2>/dev/null \
  | jq -r '.concurrency.active // 0' 2>/dev/null || echo 0)"
if [[ "${ACTIVE:-0}" != "0" ]]; then
  echo "[$(date -u +%FT%TZ)] harness busy (active=${ACTIVE}); skipping tick" >&2
  exit 0
fi
# Also guard against another poller process already running a workflow
# locally (oneshot service overlap protection).
if pgrep -f "workflow run ainbox-feature" >/dev/null 2>&1; then
  echo "[$(date -u +%FT%TZ)] another ainbox-feature workflow already running locally; skipping tick" >&2
  exit 0
fi

# Only process ONE ticket per tick — the harness can only handle one
# at a time. Take the first archon-ready ticket and break.
TICKETS="$(echo "$TICKETS" | head -1)"

while IFS= read -r TID; do
  echo "[$(date -u +%FT%TZ)] kicking off ainbox-feature for ticket $TID" >&2

  # Mark running
  CURRENT_LABELS="$(curl -fsS -H "x-api-key: $PLANE_API_TOKEN" \
    "${PLANE_BASE}/api/v1/workspaces/${WORKSPACE}/projects/${PROJECT_ID}/issues/${TID}/" \
    | jq -c '.labels')"
  NEW_LABELS="$(jq -c --arg r "$LABEL_RUNNING" '. + [$r] | unique' <<<"$CURRENT_LABELS")"
  curl -fsS -X PATCH -H "x-api-key: $PLANE_API_TOKEN" -H "Content-Type: application/json" \
    -d "{\"labels\": $NEW_LABELS}" \
    "${PLANE_BASE}/api/v1/workspaces/${WORKSPACE}/projects/${PROJECT_ID}/issues/${TID}/" >/dev/null

  # Post a comment
  bash "$(dirname "$0")/plane-comment.sh" "$TID" \
    "<p>🤖 <strong>Pandomagic workflow started.</strong> Watch this thread for gate prompts (PRD → Plan → PR). Reply <code>:approve:</code> or <code>:reject: &lt;reason&gt;</code> to drive each gate.</p>" \
    >/dev/null || echo "  ! comment post failed (non-fatal)" >&2

  # Fetch ticket content so the workflow gets the actual feature description,
  # not just an opaque ID. mission-triage needs to read this against mission.md.
  TICKET_JSON="$(curl -fsS -H "x-api-key: $PLANE_API_TOKEN" \
    "${PLANE_BASE}/api/v1/workspaces/${WORKSPACE}/projects/${PROJECT_ID}/issues/${TID}/")"
  TICKET_TITLE="$(jq -r '.name // ""' <<<"$TICKET_JSON")"
  TICKET_DESC="$(jq -r '.description_stripped // .description // ""' <<<"$TICKET_JSON")"
  TICKET_SEQ="$(jq -r '.sequence_id // ""' <<<"$TICKET_JSON")"

  # Build the workflow input: title + description, with PRD anchor extraction
  WF_INPUT="AINBOX-${TICKET_SEQ}: ${TICKET_TITLE}

${TICKET_DESC}"

  # Run the workflow non-interactively, log it
  LOG="${LOG_DIR}/ainbox-${TID}.log"
  (
    export ARCHON_TICKET_ID="$TID"
    /root/.bun/bin/bun \
      --cwd /root/Archon/packages/cli \
      /root/Archon/packages/cli/src/cli.ts \
      workflow run ainbox-feature \
      --cwd /root/.archon/workspaces/tenshimatt/ainbox/source \
      --no-worktree \
      "$WF_INPUT"
  ) > "$LOG" 2>&1 &
  disown
  echo "  -> log: $LOG" >&2
done <<<"$TICKETS"
