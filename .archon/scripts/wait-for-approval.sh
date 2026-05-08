#!/usr/bin/env bash
# wait-for-approval.sh — interactive human gate for Archon workflows.
#
# Watches TWO surfaces in parallel for the user's verdict:
#   1. /tmp/archon-gates/<gate>.pending   — local file marker
#      • approve: rm <marker>
#      • reject:  echo "REJECT: <reason>" > <marker>
#   2. Plane ticket comments (if ARCHON_TICKET_ID set)
#      • approve: comment containing ":approve:"
#      • reject:  comment containing ":reject: <reason>"
#
# When the workflow runs from the Plane poller, ARCHON_TICKET_ID is set
# automatically and the ticket comments become the discussion thread.
# A direct CLI run (no ticket) falls back to the file marker.

set -euo pipefail

GATE="${1:?gate name required}"
MESSAGE="${2:-Awaiting human approval}"
TICKET="${ARCHON_TICKET_ID:-}"

MARKER_DIR="${ARCHON_GATE_DIR:-/tmp/archon-gates}"
mkdir -p "$MARKER_DIR"
MARKER="${MARKER_DIR}/${GATE}.pending"
echo "PENDING $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$MARKER"

# Notify the operator via Telegram (audit trail, not blocking).
NOTIFY="$(dirname "$0")/notify-tg.sh"
if [[ -x "$NOTIFY" ]]; then
  GATE_UPPER=$(echo "$GATE" | tr '[:lower:]' '[:upper:]')
  "$NOTIFY" -e "GATE_${GATE_UPPER}" "${MESSAGE}" 2>/dev/null || true
fi

# Post a comment to the originating Plane ticket if we have one.
if [[ -n "$TICKET" ]]; then
  bash "$(dirname "$0")/plane-comment.sh" "$TICKET" \
    "<p>🛂 <strong>Gate: ${GATE}</strong></p><p>${MESSAGE}</p><p>Reply <code>:approve:</code> to continue or <code>:reject: &lt;reason&gt;</code> to halt.</p>" \
    >/dev/null 2>&1 || true
fi

# ─── DARK FACTORY MODE ────────────────────────────────────────────────
# When ARCHON_DARK_FACTORY=1 (or auto-detected from .archon/config.yaml),
# auto-approve immediately. Hard halts in the workflow YAML still apply.
# Audit trail preserved: the Plane comment + Telegram alert above ALWAYS post.
DARK="${ARCHON_DARK_FACTORY:-}"
if [[ -z "$DARK" && -f .archon/config.yaml ]]; then
  if grep -qE '^[[:space:]]*enabled:[[:space:]]*true' .archon/config.yaml \
     && grep -qE 'dark_factory:' .archon/config.yaml; then
    DARK=1
  fi
fi
if [[ "$DARK" == "1" ]]; then
  # gate-pr gets a 60-second cooling delay so a watchful human can :reject:
  if [[ "$GATE" == "pr" ]]; then
    COOLING="${ARCHON_PR_COOLING:-60}"
    echo "[dark-factory] gate-${GATE}: cooling ${COOLING}s before auto-approve" >&2
    SLEPT=0
    while [[ $SLEPT -lt $COOLING ]]; do
      sleep 5; SLEPT=$((SLEPT+5))
      # Mid-cool reject check (file marker only — fast)
      if grep -q '^REJECT:' "$MARKER" 2>/dev/null; then
        REASON="$(sed 's/^REJECT:[[:space:]]*//' "$MARKER")"
        rm -f "$MARKER"
        echo "{\"gate\":\"${GATE}\",\"status\":\"rejected\",\"via\":\"cool-reject\",\"reason\":\"${REASON}\"}" >&2
        exit 1
      fi
    done
  fi
  rm -f "$MARKER"
  echo "{\"gate\":\"${GATE}\",\"status\":\"approved\",\"via\":\"dark-factory\"}"
  exit 0
fi
# ─── END DARK FACTORY ────────────────────────────────────────────────

echo "════════════════════════════════════════════════════════════" >&2
echo "  HUMAN GATE: ${GATE}" >&2
echo "  ${MESSAGE}" >&2
echo "" >&2
echo "  Local approve:    rm '${MARKER}'" >&2
echo "  Local reject:     echo 'REJECT: <reason>' > '${MARKER}'" >&2
[[ -n "$TICKET" ]] && echo "  Plane approve:    comment ':approve:' on ticket $TICKET" >&2
[[ -n "$TICKET" ]] && echo "  Plane reject:     comment ':reject: <reason>'" >&2
echo "════════════════════════════════════════════════════════════" >&2

# Track the newest comment id at gate-start. Only comments newer than this
# count toward approval — prevents the bot's own gate-notice (which contains
# the literal text `:approve:` as instructions) from auto-approving the gate.
LAST_SEEN=""
if [[ -n "$TICKET" && -n "${PLANE_API_TOKEN:-}" ]]; then
  LAST_SEEN="$(bash "$(dirname "$0")/plane-fetch-ticket.sh" "$TICKET" 2>/dev/null \
    | jq -r '(.comments.results // .comments) | sort_by(.created_at) | reverse | .[0].id // ""' 2>/dev/null || echo '')"
fi

# Poll up to 24h
for _ in $(seq 1 8640); do
  # Check local marker first (fastest)
  if [[ ! -f "$MARKER" ]]; then
    echo "{\"gate\":\"${GATE}\",\"status\":\"approved\",\"via\":\"file\"}"
    exit 0
  fi
  if grep -q '^REJECT:' "$MARKER" 2>/dev/null; then
    REASON="$(sed 's/^REJECT:[[:space:]]*//' "$MARKER")"
    rm -f "$MARKER"
    echo "{\"gate\":\"${GATE}\",\"status\":\"rejected\",\"reason\":\"${REASON}\",\"via\":\"file\"}" >&2
    exit 1
  fi

  # Check Plane comments if we have a ticket
  if [[ -n "$TICKET" && -n "${PLANE_API_TOKEN:-}" ]]; then
    LATEST="$(bash "$(dirname "$0")/plane-fetch-ticket.sh" "$TICKET" 2>/dev/null \
      | jq -r '.comments.results // .comments | sort_by(.created_at) | reverse | .[0:5][] | "\(.id)|\(.comment_html // .comment_stripped)"' 2>/dev/null || true)"
    while IFS= read -r LINE; do
      [[ -z "$LINE" ]] && continue
      CID="${LINE%%|*}"
      BODY="${LINE#*|}"
      [[ "$CID" == "$LAST_SEEN" ]] && break  # stop scanning at last-seen
      if grep -qiE ':approve:' <<<"$BODY"; then
        rm -f "$MARKER"
        echo "{\"gate\":\"${GATE}\",\"status\":\"approved\",\"via\":\"plane\",\"comment_id\":\"${CID}\"}"
        exit 0
      fi
      if grep -qiE ':reject:' <<<"$BODY"; then
        REASON="$(echo "$BODY" | sed -E 's|.*:reject:[[:space:]]*||;s|<[^>]+>||g' | head -c 500)"
        rm -f "$MARKER"
        echo "{\"gate\":\"${GATE}\",\"status\":\"rejected\",\"via\":\"plane\",\"reason\":\"${REASON}\"}" >&2
        exit 1
      fi
    done <<<"$LATEST"
    LAST_SEEN="$(head -1 <<<"$LATEST" | awk -F'|' '{print $1}')"
  fi

  sleep 10
done

echo "✗ gate ${GATE} timed out after 24h" >&2
exit 2
