#!/usr/bin/env bash
# plane-comment.sh — post a comment to a Plane ticket.
#
# Usage:
#   echo "<p>...</p>" | bash .archon/scripts/plane-comment.sh <ticket_id>
#
# Or for a quick text comment:
#   bash .archon/scripts/plane-comment.sh <ticket_id> "<p>plain text</p>"
#
# Reads PLANE_API_TOKEN from env. Echoes the comment id on success.

set -euo pipefail
: "${PLANE_API_TOKEN:?PLANE_API_TOKEN required}"

TICKET="${1:?ticket id required}"
PLANE_BASE="${PLANE_BASE:-https://plane.beyondpandora.com}"
WORKSPACE="${PLANE_WORKSPACE:-beyond-pandora}"
PROJECT_ID="${PLANE_PROJECT_ID:-e11bee8b-8e92-43ea-b4e8-943fce9f204d}"

if [[ -n "${2:-}" ]]; then
  BODY="$2"
else
  BODY="$(cat)"
fi

REQ="$(jq -n --arg b "$BODY" '{comment_html: $b}')"

curl -fsS -X POST \
  -H "x-api-key: $PLANE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$REQ" \
  "${PLANE_BASE}/api/v1/workspaces/${WORKSPACE}/projects/${PROJECT_ID}/issues/${TICKET}/comments/" \
  | jq -r '.id'
