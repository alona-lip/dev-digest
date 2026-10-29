# Run Plan Skill

Executor for an **approved** Implementation Plan (`docs/plans/<feature>.md`). One command drives the
plan to verified code — dispatching the agents, keeping its own context lean (only short agent
reports), and closing every acceptance criterion of the spec with an implementation and a test.

Ported from the course branch `lesson-5-lab/sdd-finish` and changed for this repo:

- **Order:** implementer → architecture-reviewer (+ fix loop) → **test-writer from ACs** (+ code-fix
  loop) → **plan-verifier last**. The reference ran no test-writer and reviewed in parallel with
  verification; here tests are written once, after the architecture gate, so structural fixes do not
  rewrite them — and `test-writer` reads the spec before the code so tests don't copy its bugs.
- **Limits:** `max-parallel:3` for implementers and test-writers (reviewers and fixers ≤ 2), `max-fix:2` per loop, `e2e:smoke` — while typecheck,
  unit tests and `pnpm arch:check` always stay on.
- **Gate on the spec:** the plan's spec must be `Status: approved` with no open `[NEEDS CLARIFICATION]`.

`spec-creator` and `implementation-planner` run **before** this command; `/pr-self-review` and
`/workflow-retro` run **after** it, by hand.

```
/run-plan plan:docs/plans/<feature>.md [mode:multi|single] [max-parallel:N] [max-fix:N] [e2e:off|smoke|full] [tests:off]
  └─ budget check, read plan + spec header
       └─ implementer ×N           (DAG, ≤ max-parallel at once | single-agent)
            └─ architecture-reviewer ‖ correctness reviewers → implementer fixes (≤ max-fix)
                 └─ test-writer      (tests from AC-N, spec first, then code; server unit ‖ integration)
                      └─ red AC test → implementer fixes CODE, never the test (≤ max-fix)
                           └─ plan-verifier   (runs the suites; AC → task → test → commit, final gate)
                                └─ report → you run /pr-self-review, commit, /workflow-retro
```

## Agents orchestrated

| Step | Agent | Model | Role |
|------|-------|-------|------|
| 1 | `implementer` ×N | sonnet | One task each; owned paths never overlap; self-verifies |
| 2 | `architecture-reviewer` | sonnet | Structural contracts (read-only); gets `arch:check` / `check-shared` output from the orchestrator |
| 2 | `general-purpose` ×module | sonnet | Correctness reviewer: error mapping, races, boundary edge cases (read-only) |
| 2, 4 | `implementer` ×N | sonnet | Fix review findings; fix code behind red AC tests |
| 3 | `test-writer` | sonnet | Tests derived from the spec's ACs (server unit, server integration, reviewer-core) |
| 5 | `plan-verifier` | sonnet | Runs the suites itself; AC → task → test → commit matrix, final gate (read-only) |

## Inputs

| Token | Meaning | Default |
|-------|---------|---------|
| `plan:<path>` | Approved Implementation Plan. **Required.** | — |
| free-text | Notes / constraints for this run | — |
| `mode:multi` / `mode:single` | Override the plan's Execution mode | from the plan |
| `max-parallel:<n>` | Implementers / test-writers at once (reviewers, fixers ≤ 2) | `3` |
| `max-fix:<n>` | Cap per fix loop (architecture, AC tests) | `2` |
| `e2e:off\|smoke\|full` | `smoke` = e2e typecheck + flow JSON parse, no browser | `smoke` |
| `tests:off` | Skip test-writer (explicit opt-out) | on |

## Guardrails

- Never authors a spec or a plan; never edits a test to make it green.
- Never `git push`, merge or open a PR.
- Each fix loop is bounded; leftovers go to a human.
- Agents running at once own non-overlapping paths.

## File structure

```
run-plan/
├── SKILL.md     ← orchestrator: budget check → implement → review gate → AC tests → verify
└── README.md    ← this file
```
