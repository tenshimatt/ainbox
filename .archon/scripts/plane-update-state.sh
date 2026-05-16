#!/usr/bin/env bash
# plane-update-state.sh — update a Plane ticket's state and optionally swap labels.
#
# Usage:
#   bash .archon/scripts/plane-update-state.sh <ticket_id> <state_id> [remove_label_id] [add_label_id]
#
# Reads PLANE_API_TOKEN from env.

set -euo pipefail
: "${PLANE_API_TOKEN:?PLANE_API_TOKEN required}"

TICKET="${1:?ticket id required}"
STATE="${2:?state id required}"
REMOVE_LABEL="${3:-}"
ADD_LABEL="${4:-}"

PLANE_BASE="${PLANE_BASE:-https://plane.beyondpandora.com}"
WORKSPACE="${PLANE_WORKSPACE:-beyond-pandora}"
PROJECT_ID="${PLANE_PROJECT_ID:-b8bd07d5-eba9-4470-94ae-a4cec5abc2f2}"

# Patch state
curl -fsS -X PATCH \
  -H "x-api-key: $PLANE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"state\": \"$STATE\"}" \
  "${PLANE_BASE}/api/v1/workspaces/${WORKSPACE}/projects/${PROJECT_ID}/issues/${TICKET}/" \
  | jq -r '.id'

# Swap labels if requested
if [[ -n "$REMOVE_LABEL" || -n "$ADD_LABEL" ]]; then
  CURRENT_LABELS=$(curl -fsS \
    -H "x-api-key: $PLANE_API_TOKEN" \
    "${PLANE_BASE}/api/v1/workspaces/${WORKSPACE}/projects/${PROJECT_ID}/issues/${TICKET}/" \
    | jq -r '.label_ids // [] | .[]')

  NEW_LABELS="["
  FIRST=1
  while IFS= read -r lbl; do
    [[ "$lbl" == "$REMOVE_LABEL" ]] && continue
    [[ -z "$lbl" ]] && continue
    [[ $FIRST -eq 0 ]] && NEW_LABELS+=","
    NEW_LABELS+="\"$lbl\""
    FIRST=0
  done <<< "$CURRENT_LABELS"

  if [[ -n "$ADD_LABEL" ]]; then
    [[ $FIRST -eq 0 ]] && NEW_LABELS+=","
    NEW_LABELS+="\"$ADD_LABEL\""
  fi
  NEW_LABELS+="]"

  curl -fsS -X PATCH \
    -H "x-api-key: $PLANE_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"label_ids\": $NEW_LABELS}" \
    "${PLANE_BASE}/api/v1/workspaces/${WORKSPACE}/projects/${PROJECT_ID}/issues/${TICKET}/" \
    > /dev/null
fi
