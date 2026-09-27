# Insights — server

Accumulated lessons, non-trivial decisions, traps we've already run into.
Covers `src/modules/repo-intel` too — it lives inside this package.

Append-only: add to the bottom of the matching section, never rewrite or
delete. A finding that supersedes an older one gets its own dated entry; the
old entry stays. Format — `- YYYY-MM-DD — what is true. What to do or avoid
next time. (path/file.ts:42)`. Written by the `engineering-insights` skill, or
by hand in the same format.

## What Works

- 2026-09-27 — PR-list rollups are integration-tested WITHOUT running a real
  review: insert `reviews` + `findings` rows directly with an explicit
  `createdAt` per row, and build the app with
  `overrides: { github: new MockGitHubClient({ pulls: [] }) }` so the GitHub
  sync inserts nothing and the route serves only the seeded rows. "Latest"
  is then deterministic, and there is no LLM mock, no fire-and-forget run to
  `waitForPrRuns` on. ALWAYS start a new list-rollup test from this file
  rather than from `reviews.it.test.ts`, which drives the whole pipeline.
  (`server/test/pulls-list.it.test.ts`)

## What Doesn't Work

<!--
- 2026-09-18 — example entry: state what turned out to be true, then what to do
  or avoid next time, and point at the evidence. (`path/to/file.ts:42`)
-->

## Codebase Patterns

- 2026-09-20 — `src/vendor/shared` is canonical but hand-mirrored into
  `client/src/vendor/shared`; each package compiles against its own copy, so a
  field added to only one side compiles clean on the server and fails in the
  client with a confusing "two unrelated types" error. ALWAYS apply a contract
  change to both files in the same commit, then `diff` the touched region to
  confirm they match. (`server/src/vendor/shared/contracts/trace.ts:61`)
- 2026-09-20 — the review result reaches the DB through a hand-written
  projection: `ReviewOutcome` is destructured in the executor and its fields are
  passed field-by-field to `completeAgentRun`. A field the destructuring omits
  is silently dropped — no type error, no test failure — which is exactly how
  `costUsd` was computed for months and never persisted. When adding anything
  observable, diff `ReviewOutcome`'s shape against the `completeAgentRun` call
  rather than trusting the types. (`server/src/modules/reviews/run-executor.ts:213`)
- 2026-09-21 — pure, unit-tested rollup/derivation helpers for the PR list can
  sit in `pulls/status.ts` well ahead of any route actually calling them —
  `rollupSeverities()`/`SeverityCounts` had full test coverage but zero
  callers until the FINDINGS-column feature wired them into
  `GET /repos/:id/pulls`. Its keys were lowercase (`critical`/`warning`/
  `suggestion`) and had to be changed to uppercase to match the wire
  `Severity` enum before use — check this file for an existing helper before
  writing a new rollup over `findings`/`reviews`. (`server/src/modules/pulls/status.ts:16`)
- 2026-09-21 — `GET /repos/:id/pulls`'s `findings_preview` (the PR-list
  FINDINGS-column hover popover) was originally capped at 6 findings
  (`FINDINGS_PREVIEW_LIMIT`), reasoned as "it's a separate network payload,
  keep it small". User testing on a real 15-finding review showed this reads
  as broken, not intentional — the popover scrolls, so a silent "6 of 15"
  truncation just looks like scrolling stopped working. Corrected: the
  preview is NOT capped, matching the PR-detail Timeline's popover (which
  already showed every finding of a run, unlimited). A review's finding
  count is small and text-only, so sending it all is cheap — don't
  reintroduce a cap here without a concrete payload-size problem to justify
  it. (`server/src/modules/pulls/routes.ts:133`)

- 2026-09-23 — the PR-list route derives score, severity counts and cost as
  three parallel read-time rollups (IN-query + JS grouping, no FK denorm), and
  they must stay stylistically the same: each is a `Map` keyed by PR built from
  one query, resolved with `?? null` in the final `.map()`. When one of them
  changes semantics the explanatory comment above its block becomes a lie —
  the "latest completed run wins" comment survived the switch to a SUM in
  draft and would have actively misled the next reader. Treat the comment as
  part of the code being changed, not documentation of it.
  (`server/src/modules/pulls/routes.ts:169`)
- 2026-09-23 — per-PR cost is the SUM of every `status='done'` run, not the
  latest one, and the null-vs-zero cases are NOT inline in the route: they live
  in the pure `sumRunCosts` helper precisely so all four (no runs → null; runs
  but all costs null → null; mixed → sum of priced; genuine 0 → 0) are unit
  testable without a DB. Failed runs are excluded by design, so a PR whose only
  run failed shows `—` despite real token spend — a known, accepted gap, not an
  oversight to "fix" by dropping the status filter.
  (`server/src/modules/pulls/status.ts:32`)
- 2026-09-23 — multi-agent fan-out was ALREADY built into the review pipeline
  long before any UI could ask for it: `runReview()` takes `targets:
  AgentRow[]`, creates one `agent_runs` row per target and hands the whole
  list to `executeRuns()`, which loops. The single thing forcing "one agent or
  all enabled" was the ~10-line `resolveTargets()`, which understood `agentId`
  or `all: true` and nothing between. Adding an explicit N-agent selection
  therefore cost one contract field, one new branch and a repository
  `listByIds` — no migration, no new route, no change to how runs execute.
  Before estimating any "make X fan out" feature here, read `resolveTargets`
  first: the expensive-looking part is usually already list-shaped, and the
  gate is a single resolver. (`server/src/modules/reviews/service.ts:46`,
  `server/src/modules/reviews/run-executor.ts:107`)
- 2026-09-27 — one Run Review click writes ONE `reviews` row PER AGENT, so
  any PR-level rollup written as "the newest `reviews` row per PR" silently
  shows only whichever agent finished last — nothing errors, the numbers are
  just partial. That is how the PR-list FINDINGS column under-reported
  multi-agent PRs. ALWAYS group by `(pr_id, agent_id)` first — use
  `latestReviewPerAgent()` — and only then sum. The SCORE column still uses
  "newest overall" on purpose (see Open Questions).
  (`server/src/modules/pulls/status.ts:79`, `server/src/modules/pulls/routes.ts:129`)
- 2026-09-27 — `reviews.agent_id` has NO foreign key and is nullable:
  legacy/seeded reviews carry `null`, and a deleted agent leaves a dangling
  id that `agents` no longer resolves. NEVER inner-join `reviews` to `agents`
  or assume a name exists — that drops those reviews from counts. Keep null
  as its own bucket (the helper keys on `JSON.stringify([prId, agentId])`) and
  resolve names with a separate workspace-scoped IN-query where a miss means
  `agent_name: null` ("Unknown agent" in the UI).
  (`server/src/db/schema/reviews.ts:17`, `server/src/modules/pulls/routes.ts:157`)
- 2026-09-27 — supersedes Open Question (1) of the same date: the PR-list
  SCORE is now `scoreFromFindings()` (re-exported from reviewer-core) over the
  SAME findings the FINDINGS column counts, not any one agent's
  `reviews.score` and not a mean. Reason: the DevDigest Field Manual, Sheet
  05 — "the number can never contradict the list". Beware the manual's
  "findings concatenated, worst verdict wins, scores averaged" (Sheet 03,
  "Large diffs"): that is `reduceReviews` merging file slices of ONE agent's
  map-reduce run, not a rule for combining agents — don't cite it for a
  multi-agent mean. (`server/src/modules/pulls/routes.ts:278`,
  `server/specs/pr-list-findings-by-agent.md`)

## Tool & Library Notes

## Recurring Errors & Fixes

- 2026-09-21 — `seed.ts`'s PR #482 review+findings block only runs inside
  `if (!pr)` (`db:seed`'s "idempotent" claim covers workspace/user/settings,
  not this fixture). Re-running `pnpm db:seed` against a DB that already has
  PR #482 will NOT add findings appended to that block in code — the review
  row already exists so the insert is skipped entirely. To see a new seeded
  finding on an existing dev DB, insert it by hand (or drop the PR's review
  row) rather than just re-seeding. (`server/src/db/seed.ts:99`)

## Session Notes

## Open Questions

- 2026-09-27 — (1) SCORE for a multi-agent PR is still the newest review
  overall, i.e. one arbitrary agent's score; min vs mean across each agent's
  latest review was left undecided. (2) Known, accepted mismatch: PR detail
  totals EVERY run (`client/.../pulls/[number]/page.tsx` → `runs.flatMap`)
  while the list counts each agent's latest review only, so after a re-run
  the detail count is higher. Decide both together before "fixing" either.
  (`server/specs/pr-list-findings-by-agent.md`)
- 2026-09-27 — the same issue reported by two agents is counted, and
  penalised in the PR-list SCORE, twice: there is no cross-agent dedupe. The
  manual puts that in the multi-agent "conflicts" screen
  (`/repos/:id/multi-agent/:prId`, Sheet 07), which this repo doesn't have.
  Revisit if multi-agent scores look implausibly low.
  (`server/specs/pr-list-findings-by-agent.md`)
