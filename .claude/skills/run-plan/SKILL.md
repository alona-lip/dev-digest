---
name: run-plan
description: >
  Runs an already-approved DevDigest Implementation Plan (docs/plans/<feature>.md) end-to-end:
  budget check → implementer agents per the plan's DAG (multi-agent capped by max-parallel, or
  single-agent) → architecture-reviewer gate with a bounded fix loop → test-writer derives tests from
  the spec's acceptance criteria → bounded code-fix loop for red AC tests → plan-verifier as the
  final read-only gate (AC → task → test → commit). Starts FROM a plan — spec-creator and
  implementation-planner run separately beforehand. Never pushes or merges.
  TRIGGER when: "run the plan", "/run-plan", "execute the plan", "implement this plan",
  "implement docs/plans/<x>.md", "run-plan plan:<path>".
  Does NOT cover: writing specs or plans, pushing/merging, /pr-self-review or /workflow-retro
  (both manual, run by the user afterwards).
---

# Run Plan — Implementation Plan executor

> **Take an approved Implementation Plan and drive it to verified code: implement per the DAG,
> pass the architecture gate, prove every AC with a test written from the spec, and close with
> plan-verifier.**

You are the **orchestrator**, in the main session. The spec (`spec-creator`) and the plan
(`implementation-planner`) already exist and were approved by a human. You do **not** implement,
test or review yourself — you dispatch the agents and keep only their short final reports in
context. Run independent agents concurrently (several `Agent` calls in one message), never more
than `max-parallel` at once.

```
plan:<path>
 └─ Step 0  budget check + read plan & spec
     └─ Step 1  implementer ×N        (DAG; ≤ max-parallel at once | single-agent)
         └─ Step 2  architecture-reviewer → fix loop (crit/high, ≤ max-fix)
             └─ Step 3  test-writer       (tests from ACs, spec first, then code)
                 └─ Step 4  red AC tests → implementer fixes CODE (≤ max-fix)
                     └─ Step 5  plan-verifier  (AC → task → test → commit; final gate)
                         └─ report + "run /pr-self-review, then /workflow-retro" (manual)
```

**Why tests come after the architecture gate.** Architecture fixes move code between files
(logic out of a route into a service, an import through a facade). Tests written before that would
be rewritten; written after, they target the final structure once. The risk of this order — tests
fitted to finished code — is handled by `test-writer`'s spec-first rule (Step 3) and the rule that a
red AC test means fixing code, not the test (Step 4).

## Inputs (args)

| Token | Meaning | Default |
|-------|---------|---------|
| `plan:<path>` | Approved Implementation Plan. **Required.** | — |
| free-text prose | Notes / constraints for this run ("skip phase 3 for now") | — |
| `mode:multi` / `mode:single` | Override the plan's Execution mode | read from the plan |
| `max-parallel:<n>` | Max agents running at once (implementers, fixers) | `2` |
| `max-fix:<n>` | Cap for **each** fix loop (Step 2 and Step 4 separately) | `2` |
| `e2e:off\|smoke\|full` | `off` — skip; `smoke` — `cd e2e && npm run typecheck` + `JSON.parse` of changed `*.flow.json`, no browser; `full` — `cd e2e && npm test` against a running `./scripts/dev.sh` with seeded-only data | `smoke` |
| `tests:off` | Skip Step 3–4 (explicit opt-out only; Step 5 will then report ACs without tests) | on |

No `plan:` → ask for it and stop. State your interpretation of the args in one line before starting.

**Limits for first runs.** The defaults are deliberately low: two agents at a time, two fix
iterations, no browser e2e. Raise them only after a `/workflow-retro` shows the pipeline works and
the budget allows — check usage on the dashboard, not a universal number. Typecheck, unit tests
and `pnpm arch:check` are **never** switched off: without them you cannot see whether the pipeline
itself works.

## Guardrails (always)

- **Starts from a plan.** Never author or edit a spec or a plan. Missing/unreadable → stop.
- **Approved spec only.** The plan's `Spec:` line must point to a spec with `Status: approved` and
  no open `[NEEDS CLARIFICATION]`. Otherwise stop and send the user back to `spec-creator`.
- **Never `git push`, merge, or open a PR.**
- **Bounded loops.** Each fix loop stops at `max-fix` or on no progress; leftovers go to the human.
- **Owned paths never overlap** between agents running at the same time.
- **Lean context.** Hold the plan path, the spec path and each agent's short report — never paste an
  agent's transcript into your own reasoning. Pass agents paths and AC-IDs, not file dumps.

## Step 0 — Budget check, read plan and spec

1. Read the plan. Extract per task: `T-id`, `AC` list, test name, `Action`, `Module`, `Type`,
   `Skills to use`, `Owned paths`, `Depends-on`, `Known gotchas`, `Acceptance`. Read
   `## Execution mode` (a `mode:` arg overrides it). Build the DAG.
2. Read the spec header and AC list (not the whole spec): `Status`, Spec ID, AC-IDs, open
   `[NEEDS CLARIFICATION]`.
3. Print the budget line and wait for nothing — just make it visible:
   `6 tasks · multi-agent · 3 phases · max-parallel 2 · max-fix 2 · e2e smoke · models: implementer
   sonnet, architecture-reviewer sonnet, test-writer sonnet, plan-verifier sonnet`.
   If any agent the run uses is on an expensive model (`opus`), say so in that line.

## Step 1 — Implement

**Multi-agent:**
1. **Ready set** = tasks whose `Depends-on` are done and whose `Owned paths` do not overlap a running
   task. Take at most `max-parallel` of them.
2. Spawn one `implementer` per ready task in one message. Brief: the full task block, the spec path
   with the task's AC-IDs, and the **other tasks' `Owned paths`** so it stays in its lane.
3. Collect reports (`Closes: AC-…`), mark tasks done, repeat until the DAG is empty.

**Single-agent:** one `implementer` at a time, in plan order.

A task reported **blocked / failing** that cannot be fixed in scope: record it; retry once with a
sharper brief or surface it to the user — never continue past a red task others depend on.

After the last task: run the e2e level (`e2e:` arg) if the plan touched `e2e/` or the UI.

## Step 2 — Architecture gate + fix loop

Compute the changed-file set (`git diff --name-only origin/main` plus `git status --short` for
untracked files). Spawn `architecture-reviewer` on it. Backlog = findings with severity
**critical** or **high** (medium/low → report only).

Loop `i = 1 … max-fix` while the backlog is non-empty:
1. Group findings by file into non-overlapping fix tasks.
2. Dispatch `implementer`(s), ≤ `max-parallel` at once: *"Fix exactly these findings in these files,
   stay in scope, self-verify."* — with each finding's text, `file:line` and recommendation.
3. Re-run `architecture-reviewer` on the touched files only.
4. Empty → gate PASS. Same findings as last iteration → stop, flag as stuck.

Cap reached with findings left → stop the run here and report them; do **not** write tests on a
structure that is still going to change.

## Step 3 — Tests from acceptance criteria

Skip if `tests:off`. Spawn `test-writer` (one per module — `server`, `reviewer-core` — in parallel
when both are touched, ≤ `max-parallel`). Brief:

- the **spec path and its AC-IDs first**, the plan's `Traceability` table, then the changed-file set;
- *"Derive the test cases from the ACs before reading the implementation. Name every test with its
  AC-ID. If the code contradicts an AC, keep the test red and report the mismatch — do not adapt the
  expectation."*

UI ACs are covered by the implementer's colocated client tests; browser-level ACs by e2e flows.

## Step 4 — Red AC tests → fix the code

Backlog = `test-writer`'s *AC mismatches* (red tests that encode an AC).

Loop `i = 1 … max-fix` while the backlog is non-empty:
1. Decide per item: **code contradicts a clear AC** → dispatch an `implementer` with the failing test,
   the AC text and the owned files: *"Make this test pass by fixing the code. Do not edit the test."*
   **AC is ambiguous** (both readings defensible) → stop the loop for that AC and ask the user; the
   answer goes back through `spec-creator`, never into the test.
2. Re-run only the affected test files.
3. Empty → PASS. No progress → stop, flag as stuck.

## Step 5 — plan-verifier (final, read-only)

Spawn `plan-verifier` with the spec path, the plan path and the changed-file set. It returns the
matrix AC → task → test → commit and a PASS / FAIL / REVIEW gate.

- `missing` / `partial` ACs: if the Step 4 budget has iterations left, dispatch an `implementer` (and,
  for a missing test, `test-writer`) for those ACs, then re-run `plan-verifier` for them only.
  Otherwise list them for the human.
- Commits: the run itself never commits; `uncommitted` in the matrix is expected until the user
  commits.

## Final report

```
## Run Plan — <feature> (SPEC-NN)

- **Plan:** `docs/plans/<feature>.md` — mode: multi-agent | single-agent · max-parallel <n> · e2e <level>
- **Implemented:** <N> tasks (T1…Tn) — closes AC-…
- **Self-verify:** module suites + typecheck + arch:check green | failing (<detail>)

### Architecture gate
- architecture-reviewer: PASS | FAIL — crit <n> / high <n> · fix iterations <i>/<max-fix>

### Tests from ACs
- test-writer: <n> tests for <m> ACs · red AC tests fixed in code: <list> · iterations <i>/<max-fix>
- out of test-writer scope (UI / e2e): <AC-IDs>

### plan-verifier
- PASS | FAIL | REVIEW — <verified N/M>; missing/partial: <AC-IDs>

### Needs a human
- <stuck findings, ambiguous ACs, unverified ACs — or "none">

### Next steps (manual)
1. `/pr-self-review` on the uncommitted diff — BLOCK means not done.
2. Commit, then `/workflow-retro label:<feature> deep` → one row in `docs/retros/ledger.md`.
```

## When you cannot proceed

Missing/unreadable plan, a spec that is not approved, or an implementer blocked on a human decision
→ stop and say exactly what you need. "Blocked here, need X" is a valid result; a half-run that
looks complete is not.
