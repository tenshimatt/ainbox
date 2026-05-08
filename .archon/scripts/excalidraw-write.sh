#!/usr/bin/env bash
# excalidraw-write.sh — wrap an AI-generated elements array into a valid
# Excalidraw file and save it to <repo>/docs/architecture/.
#
# Input JSON shape:
#   { slug: "kebab-case-feature-name",
#     dimension: "business|data|application|technology|security|integration",
#     applicable: true|false,
#     elements: [...]
#   }
#
# If applicable=false, no file is written and "skipped: <dimension>" is echoed.
# Filename pattern: <slug>-<dimension>.excalidraw

set -euo pipefail

# Resolve repo root from script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${AINBOX_REPO:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
ARCH_DIR="${REPO_ROOT}/docs/architecture"
mkdir -p "$ARCH_DIR"

SPEC="$(cat)"
SLUG="$(jq -r '.slug' <<<"$SPEC")"
DIM="$(jq -r '.dimension' <<<"$SPEC")"
APPLICABLE="$(jq -r '.applicable // true' <<<"$SPEC")"
ELEMENTS="$(jq -c '.elements // []' <<<"$SPEC")"

if [[ -z "$SLUG" || "$SLUG" == "null" ]]; then
  echo "✗ slug missing in input JSON" >&2
  exit 2
fi
if [[ -z "$DIM" || "$DIM" == "null" ]]; then
  echo "✗ dimension missing in input JSON" >&2
  exit 2
fi

if [[ "$APPLICABLE" != "true" ]]; then
  echo "skipped: ${DIM} (not applicable to this feature)"
  exit 0
fi

OUT="${ARCH_DIR}/${SLUG}-${DIM}.excalidraw"

jq -n --argjson els "$ELEMENTS" --arg src "archon/ainbox-feature workflow / ${DIM}" \
  '{
    type: "excalidraw",
    version: 2,
    source: $src,
    elements: $els,
    appState: {
      viewBackgroundColor: "#fff8eb",
      gridSize: null,
      currentItemFontFamily: 1
    },
    files: {}
  }' > "$OUT"

echo "$OUT"
