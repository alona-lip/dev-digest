#!/usr/bin/env bash
#
# Verify the vendored contracts in client match the canonical server copy.
#
#   ./scripts/check-shared.sh          # exit 1 and print the diff on any drift
#   ./scripts/check-shared.sh --sync   # copy server → client, then verify
#
# server/src/vendor/shared is the source of truth (@devdigest/shared);
# client/src/vendor/shared is a hand-mirrored copy that each package compiles
# against on its own, so a field added on one side only compiles clean there
# and fails later as a confusing type or runtime-validation error on the other
# (server/INSIGHTS.md, 2026-09-20).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SRC=server/src/vendor/shared
DST=client/src/vendor/shared

case "${1:-}" in
  "") ;;
  --sync)
    rm -rf "$DST"
    cp -R "$SRC" "$DST"
    echo "synced $SRC → $DST"
    ;;
  -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "unknown flag: $1" >&2; exit 2 ;;
esac

if diff -r "$SRC" "$DST"; then
  echo "✓ $DST matches $SRC"
else
  echo "✗ $DST has drifted from $SRC — run ./scripts/check-shared.sh --sync" >&2
  exit 1
fi
