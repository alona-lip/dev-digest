# AGENTS.md as the source of agent instructions

Repo-wide (touches all 4 packages + root), so the spec lives in the root
`specs/`, not in a module.

## Goal

Agent instructions are readable by any coding agent, not just Claude Code:
`AGENTS.md` is the single source of truth in the root, `client/`, `server/`,
`reviewer-core/` and `e2e/`. Claude Code keeps auto-loading them as before,
because each `CLAUDE.md` is a symlink to the neighbouring `AGENTS.md` — one
file to edit, no copies to drift apart.

## Decision

- `git mv CLAUDE.md AGENTS.md`, then `ln -s AGENTS.md CLAUDE.md` in each of the
  5 directories. The link target is relative, so it survives clone and move.
  Git stores it as a symlink object (mode `120000`).
- `scripts/link-agents.sh` (re)creates the links idempotently; `--check` only
  verifies them and exits 1 on any mismatch (for CI / pre-commit).
- Live docs refer to `AGENTS.md` by its real name. Append-only / historical
  files (`*/INSIGHTS.md`, `client/specs/multi-agent-selection.md`) keep their
  `CLAUDE.md` mentions — they still resolve through the symlink.

## Rejected alternative

**`CLAUDE.md` as a one-line stub containing `@AGENTS.md`** (Claude Code's
import syntax). It works on every OS without symlink support, but it is a
second real file rather than a link: it can be edited by mistake, grows its
own content over time, and is exactly the "copy" we wanted to avoid. Symlinks
were the explicit requirement; the Windows gap is covered by the script.

## Windows caveat

Git on Windows checks out symlinks as plain text files containing the target
name (`AGENTS.md`) unless `core.symlinks=true` and Developer Mode (or admin)
are enabled. Fix: enable both and re-checkout, or run
`./scripts/link-agents.sh` (Git Bash / WSL), which replaces such stub files
with real links. The script refuses to overwrite a `CLAUDE.md` that has real
content, so a hand-edited file is never lost.

## Out of scope

- `server/clones/**` — gitignored third-party clones.
- `.claude/skills/*/AGENTS.md` — skill-internal files, unrelated to this layout.
