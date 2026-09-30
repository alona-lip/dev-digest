#!/usr/bin/env bash
#
# Keep every CLAUDE.md a symlink to the neighbouring AGENTS.md.
#
#   ./scripts/link-agents.sh          # create / repair the links
#   ./scripts/link-agents.sh --check  # verify only, exit 1 on any mismatch
#
# AGENTS.md is the source of truth; Claude Code reads it through CLAUDE.md.
# Repairs Windows checkouts where git wrote the link as a text file holding
# "AGENTS.md". Refuses to touch a CLAUDE.md with real content. See
# specs/agents-md.md.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DIRS=(. client server reviewer-core e2e)
CHECK=0

for arg in "$@"; do
  case "$arg" in
    --check)   CHECK=1 ;;
    -h|--help) sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

bad=0
for dir in "${DIRS[@]}"; do
  agents="$dir/AGENTS.md"
  claude="$dir/CLAUDE.md"
  label="${claude#./}"

  if [[ ! -f "$agents" ]]; then
    echo "✗ $agents is missing" >&2
    bad=1
    continue
  fi

  if [[ -L "$claude" && "$(readlink "$claude")" == "AGENTS.md" ]]; then
    echo "✓ $label -> AGENTS.md"
    continue
  fi

  # A regular file with real content is someone's edit — never clobber it.
  if [[ -f "$claude" && ! -L "$claude" && "$(tr -d '[:space:]' < "$claude")" != "AGENTS.md" ]]; then
    echo "✗ $label is a regular file with its own content — move it into AGENTS.md by hand" >&2
    bad=1
    continue
  fi

  if (( CHECK )); then
    echo "✗ $label is not a symlink to AGENTS.md" >&2
    bad=1
    continue
  fi

  rm -f "$claude"
  ln -s AGENTS.md "$claude"
  echo "↻ $label -> AGENTS.md (repaired)"
done

exit "$bad"
