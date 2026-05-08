#!/usr/bin/env bash
# prime-context.sh — load Ainbox PRD + most-recent architecture docs into stdout.
# Used by the workflow's prime-context node so every downstream Claude Code
# session opens with the canonical project context already in its window.
#
# Path resolution:
#   - REPO_ROOT defaults to the script's grandparent dir (the repo root).
#   - PRD lives at <repo>/docs/prd.md (was previously in Obsidian; moved into
#     the repo for the Pandomagic process so workflows running on CT 111 can
#     read/write without depending on the Mac filesystem).
#   - Architecture diagrams live at <repo>/docs/architecture/

set -euo pipefail

# Resolve the repo root from the script location: scripts/ → .archon/ → repo
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${AINBOX_REPO:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
DOCS_DIR="${REPO_ROOT}/docs"
PRD="${DOCS_DIR}/prd.md"
ARCH_DIR="${DOCS_DIR}/architecture"

cat <<'HDR'
==================================================================
PRIMED CONTEXT — AINBOX
The four governance documents below are the ALWAYS-IN-EFFECT rules
for this codebase. Cole's Dark Factory pattern: mission + factory
rules + CLAUDE + PRD loaded into every workflow node so the agent
can never drift from the spec without explicit human override.
==================================================================
HDR

echo
echo "─────────────── mission.md ───────────────"
[[ -f "$REPO_ROOT/mission.md" ]] && cat "$REPO_ROOT/mission.md" || echo "⚠ mission.md missing"

echo
echo "─────────────── factory-rules.md ───────────────"
[[ -f "$REPO_ROOT/factory-rules.md" ]] && cat "$REPO_ROOT/factory-rules.md" || echo "⚠ factory-rules.md missing"

echo
echo "─────────────── CLAUDE.md ───────────────"
[[ -f "$REPO_ROOT/CLAUDE.md" ]] && cat "$REPO_ROOT/CLAUDE.md" || echo "⚠ CLAUDE.md missing"

echo
echo "─────────────── PRD (docs/prd.md) ───────────────"
[[ -f "$PRD" ]] && cat "$PRD" || echo "⚠ PRD missing at $PRD"

echo
echo "─────────────── ARCHITECTURE (most recent 5 files) ───────────────"
if [[ -d "$ARCH_DIR" ]]; then
  shopt -s nullglob
  arch_files=("$ARCH_DIR"/*.md "$ARCH_DIR"/*.excalidraw)
  shopt -u nullglob
  if (( ${#arch_files[@]} == 0 )); then
    echo "(no architecture artefacts yet — first run for this codebase)"
  else
    # Sort by mtime descending, take top 5
    for f in $(printf '%s\n' "${arch_files[@]}" | xargs ls -t 2>/dev/null | head -5); do
      echo
      echo "▸ $f"
      if [[ "$f" == *.excalidraw ]]; then
        echo "(Excalidraw diagram — open in Obsidian to view)"
      else
        cat "$f"
      fi
    done
  fi
else
  echo "⚠ no architecture dir at $ARCH_DIR"
fi

echo
echo "─────────────── REPO META ───────────────"
echo "git: $(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo n/a)"
echo "branch: $(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo n/a)"
