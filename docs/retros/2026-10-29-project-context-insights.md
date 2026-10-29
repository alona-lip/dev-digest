# Workflow Retro — project-context-insights

**Run:** SPEC-02 (INSIGHTS.md files listed and typed as `insights`). The whole SDD cycle ran in one
session: spec-creator → implementation-planner → `/run-plan` → `/pr-self-review` (uncommitted, then
branch).
- 15 agents, all top-level (0 nested).
- Single-agent plan mode.
- Data: deep (journals).

## Metrics

| agent | role | model | out | cache-read | cache-write | hit% | tools | span* |
|-------|------|-------|-----|------------|-------------|------|-------|-------|
| spec-creator (4 rounds) | spec | opus | 75.4k | 2.92M | 294k | 91% | 55 | 914s |
| implementation-planner (2 rounds) | plan | opus | 58.4k | 2.63M | 428k | 86% | 33 | 471s |
| implementer T1–T4 | code | sonnet | 8.2k | 827k | 170k | 83% | 17 | 65s |
| architecture-reviewer | gate | sonnet | 14.4k | 649k | 489k | 57% | 29 | 33s |
| correctness reviewer (2 rounds) | gate | sonnet | 12.4k | 447k | 127k | 78% | 8 | 605s |
| implementer (W2 fix) | fix | sonnet | 4.1k | 446k | 106k | 81% | 13 | 29s |
| test-writer unit (T5) | tests | sonnet | 23.6k | 842k | 189k | 82% | 15 | 83s |
| test-writer it (T6) | tests | sonnet | 11.4k | 781k | 198k | 80% | 15 | 79s |
| plan-verifier | verify | sonnet | 10.8k | 502k | 186k | 73% | 17 | 85s |
| pr-self-review ×6 (onion, fastify, drizzle, security, ts, zod) | review | sonnet | 5.8k | 499k | 440k | 40–61% | 27 | 7–15s each |

\* An agent's span runs from its first start to its last stop, so it includes time spent waiting for
the user between resumes. The spec-creator, planner and correctness-reviewer spans are inflated for
this reason.

**Subagent totals:**
- input 382, output 224k, cache-read 10.5M, cache-write 2.63M.
- cache hit 80%, 229 tool calls.
- wall 2456s; parallelism 0.99x (understated: resume gaps count as span).

**Main session (orchestrator):** output 148k, cache-read 24.8M, cache-write 418k, hit 98%, 114 tools.

**Cost:** n/a. Prices were not verified, so none were applied.

**Model mix:** opus 2 agents, which produced 60% of subagent output; sonnet 13.

**Launch order:** spec-creator (×4) → planner (×2) → implementer → (arch-reviewer ‖ correctness)
→ implementer fix → correctness re-check → (test-writer unit ‖ test-writer it) → plan-verifier
→ 6 pr-self-review reviewers (parallel). The branch-scope run was cache-only and used 0 agents.

**Critical path:** spec phase. spec-creator plus planner made up about 60% of subagent output, and
the user answered 4 rounds of questions.

**Outcome:**
- 16/16 ACs verified; review gate PASS after 1 of 2 fix iterations.
- `/pr-self-review` PASS on both scopes.
- 0 red AC tests and 0 hook denials.

## What went well

- **Root cause found in the main session before any agent ran.** One picomatch check showed that
  `server/INSIGHTS.md` does not match the old default glob. The spec could start from facts instead
  of hypotheses.
- **The correctness reviewer paid off.** This was the 2026-10-28 retro's top recommendation. It
  found a real WARNING (case-sensitive `EXCLUDED_DIRS` under a nocase matcher), which was fixed in 1
  iteration before tests were written.
- **Test-writers were split into unit and integration and ran in parallel** (83s ‖ 79s), as the last
  retro recommended. Neither found an AC mismatch.
- **Implementation was clean on the first try.** The implementer finished T1–T4 in 65s, and the
  architecture gate had 0 findings.
- **The branch-scope `/pr-self-review` was 100% cache hits** (198 units): no agents, 8 checks green.

## What was hard / wasteful

- **The spec needed 4 rounds and the planner needed 2.** The largest cost item in the run.
  - Round 2: three open questions, a natural first draft.
  - Round 3: a conflict between "an explicit `CONTEXT_GLOB` is honoured as-is" (from the
    orchestrator's first brief) and "ignore case everywhere".
  - Round 4: AC-13 ("existing tests pass with no edited assertions") contradicted AC-12, because
    `project-context.it.test.ts:108` asserts the old glob literal. spec-creator did not catch this;
    implementation-planner did, which cost a planner round and a spec round.
- **The planner always blocks once on execution mode.** As a subagent it has no `AskUserQuestion`,
  so it returned the question instead of a plan, for a 7-file server-only change.
- **Structural review ran three times over the same 5 files.**
  - `pnpm arch:check` (green).
  - `architecture-reviewer`: 0 findings, 489k cache-write. It read docs for modules the diff does not
    touch (reviewer-core AGENTS, grounding).
  - `/pr-self-review`'s onion-architecture reviewer: 0 findings.
  - The single `/pr-self-review` SUGGESTION (detached docblock in `config.ts`) had already been
    noted as out of scope by architecture-reviewer.
- **Reviewers ran on files outside their skill's scope.** `routing.json` sent drizzle-orm-patterns
  and fastify-best-practices to `fs-reader.ts`, `config.ts` and `helpers.ts`, which have no data
  access or routes. Both returned `[]` (~68k cache-read each).
- **The flaky `skills.it.test.ts` was re-checked 3 times** (by test-writer T6, by the orchestrator,
  and by plan-verifier). It is already listed in `server/INSIGHTS.md` Open Questions; this run makes
  it recurrent.
- **Orchestrator slip:** the `/pr-self-review` cache lookup loop ran in zsh, which does not
  word-split `$files`. All 5 lookups failed and had to be rerun under bash.

## Recommendations (actionable)

1. **spec-creator** (`.claude/agents/spec-creator.md`) — **applied 2026-10-29**: when an AC changes a default or constant, or
   claims "existing tests stay unchanged", grep `*/test/**` for the old literal first, and name every
   hit as an allowed change inside the AC. Expected effect: it would have removed the AC-13 round,
   saving 1 spec round and 1 planner round (~15–20k opus output).
2. **Orchestrator / `run-plan` pre-step** (applied 2026-10-29 in `implementation-planner.md` Step 2 and `.claude/agents/README.md`): ask the user for the execution mode, and pass any decisions
   already made, in the implementation-planner brief. Expected effect: removes the planner's
   guaranteed blocked round.
3. **`pr-self-review/routing.json`:** restrict `drizzle-orm-patterns` to `**/repository/**`,
   `**/db/**` and services, and `fastify-best-practices` to `routes.ts`, `app.ts`, `server.ts` and
   plugins. Expected effect: 2 fewer empty reviewers on adapter/config/helper-only diffs.
   **Withdrawn 2026-10-29.** This is the file-level backend routing that `specs/pr-self-review.md`
   (2026-10-14 revision) rejected. It would miss fastify and drizzle concerns in `service.ts`, and
   `required_core` pins Backend = Onion + fastify + drizzle. The existing `focus` hint already makes
   those reviewers return `[]` cheaply.
4. **`run-plan` Step 2:** for a diff with no new files or new imports and a green `arch:check`, brief
   `architecture-reviewer` with only the touched-module docs, or skip it. The `/pr-self-review`
   onion reviewer still covers structure. Expected effect: about 490k fewer cache-write tokens on
   small diffs.
5. **`server/test/skills.it.test.ts`:** fix the trace race by polling the trace endpoint, not only
   the run status, as INSIGHTS suggests. Expected effect: no more re-runs by 3 agents.
6. **`pr-self-review/SKILL.md`:** run the per-skill cache-lookup snippet under `bash -c`, or pass
   files via `xargs`. Expected effect: no zsh word-splitting failure.
