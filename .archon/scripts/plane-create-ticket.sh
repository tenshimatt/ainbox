#!/usr/bin/env bash
# plane-create-ticket.sh — create a Plane ticket from a JSON spec on stdin.
#
# Usage (from inside an Archon workflow `bash:` node):
#   echo '{"name":"...","prd_section":"§7.4","priority":"high","description_html":"<p>...</p>"}' \
#     | bash .archon/scripts/plane-create-ticket.sh
#
# Reads PLANE_API_TOKEN from env. Echoes the created issue's JSON to stdout.
# Exits non-zero if the POST fails — the harness will surface the error.

set -euo pipefail

: "${PLANE_API_TOKEN:?PLANE_API_TOKEN env var is required}"

# Defaults — read from .archon/config.yaml could be wired later via yq;
# inline for now so the script has zero deps beyond curl + jq.
PLANE_BASE="${PLANE_BASE:-https://plane.beyondpandora.com}"
WORKSPACE="${PLANE_WORKSPACE:-beyond-pandora}"
PROJECT_ID="${PLANE_PROJECT_ID:-b8bd07d5-eba9-4470-94ae-a4cec5abc2f2}"

PAYLOAD="$(cat)"
NAME="$(jq -r '.name' <<<"$PAYLOAD")"
PRD_SECTION="$(jq -r '.prd_section // empty' <<<"$PAYLOAD")"
PRIORITY="$(jq -r '.priority // "medium"' <<<"$PAYLOAD")"
DESC="$(jq -r '.description_html // empty' <<<"$PAYLOAD")"

if [[ -z "$PRD_SECTION" ]]; then
  echo "✗ refusing to create a ticket without prd_section — PRD ref is mandatory" >&2
  exit 2
fi

# Force the PRD anchor to the top of the description.
DESC="<p><strong>PRD:</strong> ${PRD_SECTION}</p>${DESC}"

REQ="$(jq -n --arg n "$NAME" --arg d "$DESC" --arg p "$PRIORITY" \
  '{name: $n, description_html: $d, priority: $p}')"

curl -fsS -X POST \
  -H "x-api-key: $PLANE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$REQ" \
  "${PLANE_BASE}/api/v1/workspaces/${WORKSPACE}/projects/${PROJECT_ID}/issues/"
