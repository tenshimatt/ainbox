#!/usr/bin/env bash
set -euo pipefail

# compose.sh — Wrapper for compose.py
# Composes a project workflow YAML with the shared 2-tier classifier.
#
# Usage: compose.sh <project-yaml-path> [output-path]
#
#   compose.sh .archon/workflows/ainbox-feature.yaml
#     → .archon/workflows/ainbox-feature.full.yaml
#
#   compose.sh .archon/workflows/ainbox-feature.yaml deploy.yaml
#     → deploy.yaml
#
# Requires: python3 with PyYAML installed

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_PY="$SCRIPT_DIR/compose.py"
PROJECT_YAML="${1:?Usage: compose.sh <project-yaml> [output-path]}"
OUTPUT="${2:-${PROJECT_YAML%.yaml}.full.yaml}"

if [ ! -f "$COMPOSE_PY" ]; then
  echo "✗ compose.py not found alongside this script: $COMPOSE_PY" >&2
  exit 1
fi

if [ ! -f "$PROJECT_YAML" ]; then
  echo "✗ Project YAML not found: $PROJECT_YAML" >&2
  exit 1
fi

python3 "$COMPOSE_PY" "$PROJECT_YAML" "$OUTPUT"
