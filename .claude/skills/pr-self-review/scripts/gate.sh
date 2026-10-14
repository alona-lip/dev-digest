#!/usr/bin/env bash
# Thin entry point for the hooks; the logic lives in gate.mjs (see its header).
exec node "$(dirname "${BASH_SOURCE[0]}")/gate.mjs" "$@"
