#!/usr/bin/env bash
#
# The changes under review, in one of two scopes:
#   uncommitted (default) — staged + unstaged + untracked vs HEAD: the "done?" check
#   branch                — everything since merge-base with main: the pre-PR check
#
#   collect-diff.sh [--scope uncommitted|branch] base            # the base commit sha
#   collect-diff.sh [--scope uncommitted|branch] files           # `STATUS<TAB>path` lines
#   collect-diff.sh [--scope uncommitted|branch] diff [path...]  # unified diff (-U10)

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

SCOPE=uncommitted
if [ "${1:-}" = "--scope" ]; then
  SCOPE="${2:-}"
  shift 2
fi

base() {
  case "$SCOPE" in
    uncommitted) git rev-parse HEAD ;;
    branch)
      for ref in origin/main main origin/master master; do
        if git rev-parse --verify -q "$ref" >/dev/null; then
          git merge-base HEAD "$ref"
          return
        fi
      done
      echo "no origin/main or main to compare against" >&2
      exit 1
      ;;
    *) echo "unknown scope: $SCOPE (uncommitted|branch)" >&2; exit 2 ;;
  esac
}

untracked() { git ls-files --others --exclude-standard; }

case "${1:-}" in
  base) base ;;
  files)
    git diff --name-status -M "$(base)"
    untracked | while IFS= read -r f; do printf 'A\t%s\n' "$f"; done
    ;;
  diff)
    shift
    b="$(base)"
    if [ "$#" -gt 0 ]; then
      git diff -U10 -M "$b" -- "$@"
      for f in "$@"; do
        if untracked | grep -qxF -- "$f"; then
          git diff --no-index -U10 -- /dev/null "$f" || true
        fi
      done
    else
      git diff -U10 -M "$b"
      untracked | while IFS= read -r f; do
        git diff --no-index -U10 -- /dev/null "$f" || true
      done
    fi
    ;;
  *) echo "usage: collect-diff.sh [--scope uncommitted|branch] base|files|diff [path...]" >&2; exit 2 ;;
esac
