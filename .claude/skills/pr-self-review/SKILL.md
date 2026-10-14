---
name: pr-self-review
description: "PR Self Review: a second-pass review of your own changes, run BEFORE calling a task done and before opening a PR. Reviews the uncommitted diff (default) or the whole branch (--scope branch), groups changed files into buckets by surface — Frontend (client/: UI architecture + react + React Testing Library), Backend (server/: Onion + Fastify + Drizzle), Database, Engine, Shared contracts — runs those skills as independent reviewers plus deterministic checks, and returns PASS or BLOCK. One confirmed CRITICAL means BLOCK: the task is not done, and git push / gh pr create are refused. Use after implementing a change and before saying done / готово / ready / complete, before git push or opening a PR, when the user says self review or pre-PR review, or when the gate reports a missing verdict. Not for reviewing someone else's PR (use code-review)."
metadata:
  version: 1.1.0
  updated: 2026-10-14
  tags: review, pull-request, gate, skills-routing, buckets
---

# PR Self Review

A second pass over your own diff, by reviewers that did not write it. Spec and
rejected alternatives: [specs/pr-self-review.md](../../../specs/pr-self-review.md).
**What gets checked, per bucket: [routing.md](routing.md)** (generated from
[routing.json](routing.json), the source of truth for the scripts).

All commands run from the repo root. `S=.claude/skills/pr-self-review/scripts`.
Intermediate files go in the scratchpad directory (`$SCRATCH`), never in the repo.

## When this runs — two scopes

| Moment | Scope | What is reviewed | Verdict is valid for |
|---|---|---|---|
| **Before saying "done"** (session protocol, `AGENTS.md`) | `uncommitted` (default) | staged + unstaged + untracked vs `HEAD` | this exact working tree — any later edit makes it stale |
| **Before `git push` / `gh pr create`** (gate hooks) | `branch` | everything since `merge-base` with `main`, committed | this exact commit |

- **"Done" rule:** a task that changed code under `client/`, `server/` or
  `reviewer-core/` is not done until this skill PASSes on the uncommitted diff.
  `$S/gate.sh check --worktree` tells you whether the current tree has a PASS.
  Do not report the task as complete on BLOCK — report what blocks instead.
- **PR rule:** the push / PR gate needs a `--scope branch` PASS for `HEAD`, made
  on a clean tree. After a "done" PASS, commit and run with `--scope branch`:
  file reviews come from the cache, so it is quick.
- Manually: `/pr-self-review`, `/pr-self-review --scope branch`, `--no-cache`.

## Workflow

`SCOPE` is `uncommitted` unless asked for `branch` (or the push gate sent you here).

### 1. Collect

```bash
BASE=$($S/collect-diff.sh --scope $SCOPE base)
$S/collect-diff.sh --scope $SCOPE files > $SCRATCH/entries.txt      # STATUS<TAB>path
```

Empty `entries.txt` → nothing to review: say so and stop.

### 2. Route into buckets

```bash
node $S/check-routing.mjs                                           # integrity of routing.json
node $S/route.mjs < $SCRATCH/entries.txt > $SCRATCH/route.json
```

`route.json` = `{buckets: {name: {files, skills: {skill: [files]}}}, caps, focus,
uncovered, ignored, deleted}`. Never improvise routing. If `check-routing` fails
(e.g. a new skill is not mapped, or a required core changed), report it and stop.

Before reviewing, tell the user the plan in one short block, bucket by bucket —
e.g. `Frontend (4 files): frontend-ui-architecture, react-best-practices,
react-testing-library, next-best-practices`.

### 3. Deterministic checks (start in parallel with step 4)

```bash
node $S/checks.mjs --base $BASE < $SCRATCH/entries.txt > $SCRATCH/checks.json   # --no-cache to force
```

Triggers come from `routing.json` → `checks`. A failing CRITICAL check blocks and
**cannot be waived**. `skipped` (dependencies not installed) is not a pass — say so.

### 4. Review — one subagent per (bucket, skill)

For each bucket in `route.json`, for each skill in it:

1. `node $S/cache.mjs lookup --skill <skill> --files <files…>` → reuse `hit`
   findings; review only `miss` files (`--no-cache` → all miss).
2. Spawn one subagent per **(bucket, skill)** with a non-empty miss list — **all
   in one message, so they run in parallel** — with the Reviewer prompt from
   [references/reviewer-prompt.md](references/reviewer-prompt.md), filling
   `{{bucket}}`, `{{skill}}`, `{{files}}`, `{{scope}}`, `{{cap}}` and
   `{{focus}}` (from `route.json.focus[skill]`, if any).
3. Parse each reply as a JSON array and set `bucket` on every finding. Invalid
   JSON → re-ask that agent once; still invalid → add `"<bucket>/<skill>"` to
   `$SCRATCH/not-reviewed.json`. It blocks: an unreviewed skill is unknown, not clean.
4. Lower any finding above `route.json.caps[skill]` to the cap.

Severity follows [references/severity.md](references/severity.md), **not** the
category labels inside the skills.

### 5. Verify every CRITICAL

One verifier subagent per CRITICAL (Verifier prompt, same file), in parallel.
Take the verifier's severity. Merge duplicates (same file, overlapping lines,
same issue → one finding, skills joined with `, `). Then cache:

```bash
node $S/cache.mjs store --skill <skill> --files <reviewed files…> --findings <that skill's final findings.json>
```

### 6. Waivers

```bash
node $S/waivers.mjs --findings $SCRATCH/findings.json > $SCRATCH/waived.json   # → {findings, warnings}
```

A waived CRITICAL does not block but is shown. Never write or edit a waiver
yourself to get a PASS — it is the author's decision, with a reason.

### 7. Verdict and report

Split `waived.json` into `$SCRATCH/final.json` (findings) and
`$SCRATCH/warnings.json`, then:

```bash
node $S/report.mjs --scope $SCOPE --findings $SCRATCH/final.json --checks $SCRATCH/checks.json \
  --route $SCRATCH/route.json --entries $SCRATCH/entries.txt --warnings $SCRATCH/warnings.json \
  --not-reviewed $SCRATCH/not-reviewed.json --base $BASE --stats '{"reviewed":N,"cached":M}'
```

It writes the verdict (`wt-<fingerprint>.json` or `<HEAD>.json` under
`.git/pr-self-review/`) and prints the report **grouped by bucket**. Show it as is, then:

- **BLOCK** → the task is not done / not ready for a PR. List what must change and
  offer to fix. Never push, open a PR, or suggest `--no-verify`. Re-run after fixing.
- **PASS, `uncommitted`** → the task may be reported as done. Mention that a PR
  needs a `--scope branch` run after committing.
- **PASS, `branch`** → point to the PR draft (`.git/pr-self-review/<HEAD>.pr.md`)
  and offer `gh pr create --body-file <path>` (or the text, if `gh` is missing).

## Rules

- Review only; never change code, routing, waivers or hooks during a review.
- Findings are about code **this diff** introduced or worsened.
- Report honestly what was not covered: the Not covered bucket, skipped checks,
  reviewers that did not answer.

## Maintaining

- Change routing in `routing.json`, then regenerate the table and check:
  `node $S/route.mjs --print-table > .claude/skills/pr-self-review/routing.md && node $S/check-routing.mjs`.
- New skill in `.claude/skills/` → add it to a bucket (core/extras) or `excluded`.
- `required_core` pins the requirement (Frontend = UI-arch + react + RTL, Backend =
  Onion + fastify + drizzle); `check-routing` fails if a bucket drifts from it.
- Tests: `node --test .claude/skills/pr-self-review/scripts/`.
- Git hook, once per clone: `git config core.hooksPath scripts/git-hooks`.
