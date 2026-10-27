#!/usr/bin/env bash
# PreToolUse hook for Write|Edit|MultiEdit|NotebookEdit, wired from an agent's
# frontmatter. Lets the agent write only the files its role owns:
#   spec      → <client|server|reviewer-core|mcp-server>/specs/*.md, specs/*.md,
#               e2e/docs/specs/*.md (e2e/specs holds flow JSON, not specs)
#   plan      → docs/plans/*.md (not *.research.md)
#   research  → docs/plans/*.research.md
# Anything else exits 2, which blocks the call and feeds stderr back to the agent.
set -euo pipefail

role="${1:-}"
input="$(cat)"
# Fail closed: any exit code other than 2 lets the write through.
command -v jq >/dev/null 2>&1 || { echo "restrict-writes: jq not found — blocking the write." >&2; exit 2; }
file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')"

deny() {
  echo "restrict-writes ($role): '$file_path' is outside this agent's write scope. $1" >&2
  exit 2
}

[[ -n "$file_path" ]] || deny "No file path in the tool call."

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
root="${root%/}"
case "$file_path" in
  "$root"/*) rel="${file_path#"$root"/}" ;;
  /*) deny "Absolute paths must be inside the project ($root)." ;;
  *) rel="$file_path" ;;
esac
rel="${rel#./}"

case "/$rel/" in
  */../*|*/./*) deny "Relative segments ('..', '.') are not allowed." ;;
esac

case "$role" in
  spec)
    allowed='Allowed: <client|server|reviewer-core|mcp-server>/specs/<name>.md, specs/<name>.md, or e2e/docs/specs/<name>.md (e2e/specs holds flow JSON, not specs).'
    [[ "$rel" =~ ^((client|server|reviewer-core|mcp-server)/|e2e/docs/)?specs/[A-Za-z0-9._-]+\.md$ ]] || deny "$allowed"
    ;;
  plan)
    allowed='Allowed: docs/plans/<feature>.md (research notes belong to the researcher).'
    [[ "$rel" =~ ^docs/plans/[A-Za-z0-9._-]+\.md$ && "$rel" != *.research.md ]] || deny "$allowed"
    ;;
  research)
    allowed='Allowed: docs/plans/<feature>.research.md only.'
    [[ "$rel" =~ ^docs/plans/[A-Za-z0-9._-]+\.research\.md$ ]] || deny "$allowed"
    ;;
  *)
    deny "Unknown role '$role' — expected spec | plan | research."
    ;;
esac

exit 0
