# PR self-review skill

Repo-wide (touches `.claude/`, `scripts/`, and routes over all 4 packages), so
the spec lives in the root `specs/`.

## Goal

Before a branch is pushed or a PR opened, the author (or Claude) runs
`/pr-self-review`. It collects every local change, matches each changed file to
the project skills that apply to it (UI skills on `client/**`, backend and
architecture skills on `server/**` and `reviewer-core/**`), runs them, and
returns `PASS` or `BLOCK`. One confirmed CRITICAL finding means `BLOCK`, and a
local gate refuses `git push` and `gh pr create` until the verdict for the
current `HEAD` is `PASS`.

## Decision

- **Routing is a table, not a judgement.** `routing.json` maps globs to skills;
  `route.mjs` applies it; `check-routing.mjs` fails if a skill exists in
  `.claude/skills/` that is neither routed nor explicitly excluded.
- **One subagent per skill**, run in parallel, each given only its files. Every
  CRITICAL is re-checked by a separate verifier subagent before it can block.
- **Severity is normalised.** Skills tag whole rule categories "CRITICAL"; a
  finding is CRITICAL only by the repo definition (`docs/agent-prompts/
  general-reviewer.md`): security breach, data loss, wrong result, crash, broken
  contract, or touching a do-not-touch zone.
- **Deterministic checks run first, without an LLM**: applied migrations
  untouched, `link-agents --check`, `check-shared`, `arch:check`, typecheck and
  unit tests of the touched packages. A red one is CRITICAL and not waivable.
- **The gate only reads a verdict**, `.git/pr-self-review/<HEAD-sha>.json`. It
  is installed twice: a Claude Code `PreToolUse` hook on `git push` /
  `gh pr create`, and a git `pre-push` hook (`core.hooksPath`).
- **A verdict made with uncommitted changes never opens the gate** (`dirty`):
  what gets pushed is the commit, not the working tree.
- **Cache** per (skill, file blob hash, skill version) so a re-run only reviews
  what changed. **Waivers** (`.pr-self-review-waivers.json`) with reason and
  expiry cover false positives. **PR description draft** is written on `PASS`.

## Rejected alternatives

- **The model reads skill descriptions and decides what applies.** Not
  reproducible between runs and impossible to test; the table is both.
- **One subagent holding every skill.** Context overload, skills blur together,
  findings cannot be attributed to a skill.
- **GitHub required status check.** Truly blocks the Merge button, but needs
  `gh` and branch protection; deliberately out of scope for this iteration.
- **Running the review inside `pre-push` via `claude -p`.** Slow and paid on
  every push; the hook reads a finished verdict instead.

## Honest limits

`git push --no-verify` bypasses the git hook. It is a local safety net for
honest mistakes, not a server-side control.

## Out of scope

Publishing to GitHub, reviewing `e2e/**` (no skill covers it; reported as
uncovered), auto-fixing findings, DevDigest's own `reviewer-core` pipeline.
Next iteration: diff size limit, `--files <path>`, `--quick`, a
`history.jsonl` to measure false positives.

## 2026-10-14 revision — "before done", uncommitted diff, buckets

Requirement, restated: *before a task is reported done, a second pass runs over
the uncommitted diff and routes by changed surface: client → UI architecture +
react + RTL; backend → Onion + fastify + drizzle.* The first version only ran
before push / PR, reviewed the whole branch, treated a dirty tree as invalid,
ran RTL only on test files, and fastify / drizzle only on HTTP / data-access files.

### Decision

- **Two scopes.** `uncommitted` (default): staged + unstaged + untracked vs
  `HEAD`; its verdict is keyed by a working-tree fingerprint (HEAD + blob of every
  uncommitted path), so any edit makes it stale — `gate.sh check --worktree`.
  `branch`: unchanged, keyed by commit, required by the push / PR gate. Going
  from "done" to PR is cheap: after committing, blobs are identical, so the
  per-file review cache hits.
- **"Before done" is a protocol rule** (root `AGENTS.md`, `docs/workflow.md`
  phase 4, skill description), not a hook.
- **Buckets instead of flat rules.** Each changed file lands in exactly one
  bucket — Frontend, Backend, Database, Engine, Shared contracts, or Not
  covered — with `core` skills, `extras`, and the deterministic checks it
  triggers. `required_core` pins the requirement and `check-routing` fails on
  drift. One reviewer subagent per (bucket, skill).
- **Surface routing for the backend:** every changed `server/src` file gets
  Onion + fastify + drizzle (with a `focus` hint telling fastify / drizzle to
  return nothing for files outside their concern). **RTL on client source too**,
  checking that changed behaviour is covered by the colocated test (WARNING at most).
- **Engine (`reviewer-core`) keeps Onion only**: it has no Fastify and no Drizzle.
- **`routing.json` stays the source of truth; `routing.md` is generated** from it
  (`route.mjs --print-table`) for humans, and a test fails if they diverge.
- Check triggers moved into `routing.json` (`checks.<name>.on`); commands stay in
  `checks.mjs`; `check-routing` keeps both lists in sync.
- A reviewer that never returns valid JSON now **blocks** (unknown ≠ clean).

### Rejected alternatives

- **File-level routing for the backend** (fastify only on routes, drizzle only on
  repositories): cheaper, but misses fastify / drizzle concerns in `service.ts`
  (transactions, error mapping) and departs from the requirement.
- **A `Stop` hook forcing the review before every answer ends**: fires on every
  reply, and "done" cannot be told apart from an intermediate message;
  the protocol rule was chosen instead.
- **Keeping flat rules and grouping only in the report**: "what is checked"
  would still have to be reverse-engineered from a dozen regexes.
- **`routing.md` as the source, parsed by the scripts**: one formatting slip in a
  markdown table would silently drop files from review.
