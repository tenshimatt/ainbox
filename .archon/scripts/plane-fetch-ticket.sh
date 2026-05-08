#!/usr/bin/env bash
# plane-fetch-ticket.sh — fetch a Plane ticket + its comments as JSON.
#
# Usage:
#   bash .archon/scripts/plane-fetch-ticket.sh <ticket_id>
#
# Returns: { issue: {...}, comments: [...] }

set -euo pipefail
: "${PLANE_API_TOKEN:?PLANE_API_TOKEN required}"

TICKET="${1:?ticket id required}"
PLANE_BASE="${PLANE_BASE:-https://plane.beyondpandora.com}"
WORKSPACE="${PLANE_WORKSPACE:-beyond-pandora}"
PROJECT_ID="${PLANE_PROJECT_ID:-f88111cd-cac2-4e9f-af38-2241e215c4ad}"

ISSUE="$(curl -fsS -H "x-api-key: $PLANE_API_TOKEN" \
  "${PLANE_BASE}/api/v1/workspaces/${WORKSPACE}/projects/${PROJECT_ID}/issues/${TICKET}/")"

COMMENTS="$(curl -fsS -H "x-api-key: $PLANE_API_TOKEN" \
  "${PLANE_BASE}/api/v1/workspaces/${WORKSPACE}/projects/${PROJECT_ID}/issues/${TICKET}/comments/")"

jq -n --argjson i "$ISSUE" --argjson c "$COMMENTS" '{issue: $i, comments: $c}'
