#!/usr/bin/env bash
# archon-rag-query.sh — query Archon v1 RAG for similar past patterns.
#
# Usage:
#   echo "supplier search filter dropdown" | bash .archon/scripts/archon-rag-query.sh
#
# Reads stdin as the query, hits the Archon v1 RAG API on CT 111, prints
# the top results as JSON. Used by the workflow's rag-check node so the
# planner has prior-art context before designing.

set -euo pipefail

ARCHON_BASE="${ARCHON_RAG_BASE:-http://10.90.10.11:8181}"
PROJECT_ID="${ARCHON_PROJECT_ID:-da8c5635-b18c-4595-ba06-9c3e268dd3d3}"   # Ainbox
LIMIT="${ARCHON_RAG_LIMIT:-5}"

QUERY="$(cat)"
if [[ -z "$QUERY" ]]; then
  echo "✗ archon-rag-query: empty query" >&2
  exit 2
fi

REQ="$(jq -n --arg q "$QUERY" --arg p "$PROJECT_ID" --argjson n "$LIMIT" \
  '{query: $q, project_id: $p, match_count: $n}')"

# Fetch matching knowledge chunks AND code examples in parallel, merge.
KNOW="$(curl -fsS -X POST \
  -H "Content-Type: application/json" \
  -d "$REQ" \
  "${ARCHON_BASE}/api/rag/query")"

CODE="$(curl -fsS -X POST \
  -H "Content-Type: application/json" \
  -d "$REQ" \
  "${ARCHON_BASE}/api/rag/code-examples" || echo '{"results":[]}')"

jq -n --argjson k "$KNOW" --argjson c "$CODE" \
  '{query_results: $k, code_examples: $c}'
