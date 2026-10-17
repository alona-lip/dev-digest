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


- 2026-10-16 — a skills-in-the-prompt test needs no real LLM: build the app with
  `overrides.llm = { openai: mock }`, keep the `MockLLMProvider` instance in a
  variable, run a review, then read `mock.calls.find(c => c.method ===
  'completeStructured').req.messages[0].content` — that IS the system message the
  model got. Combine with `GET /runs/:id/trace` for `skill_blocks` and `log`.
  (`server/test/skills.it.test.ts`)

## What Doesn't Work

<!--
- 2026-09-18 — example entry: state what turned out to be true, then what to do
  or avoid next time, and point at the evidence. (`path/to/file.ts:42`)
-->
- 2026-10-12 — writing the dependency-cruiser baseline before triaging the
  first run freezes false positives as "known violations": the first cut of the
  onion rules reported 49 errors, 15 of them false — reviewer-core's
  `@devdigest/shared` resolves to `server/src/vendor/shared` (looked like
  "reviewer-core imports server"), `reviewer-core/src/llm/structured.ts`
  legitimately imports `openai/helpers/zod`, and type-only cycles
  (`agents/helpers.ts` ↔ `agents/repository.ts`) tripped `no-circular`. ALWAYS
  run with `--no-ignore-known`, fix the rules until every hit is a real
  violation, and only then `pnpm arch:baseline`. (`server/.dependency-cruiser.cjs`)

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
- 2026-10-12 — `pnpm arch:check` only sees imports, so `container.db` used in a
  route or service without a `drizzle-orm`/`db/schema` import (e.g.
  `container.db.query.*`, or a service holding `this.container`) passes the
  check while still bypassing the repository ring. Because the tool is green,
  NEVER treat a passing arch:check as proof a handler is thin — grep the diff
  for `container.db` and apply the onion-architecture skill's review checklist.
  (`server/src/modules/pulls/routes.ts:44`, `.claude/skills/onion-architecture/SKILL.md`)
- 2026-10-12 — `withRetry`'s default `isRetryable` reads `err.status` BEFORE
  `err.statusCode`, and retries anything ≥500. So wrapping an SDK error in an
  `AppError` subclass (whose `statusCode` is the HTTP answer, e.g. 502 for
  `ExternalServiceError`) silently makes every upstream 404/422 retryable —
  unless the mapped error keeps the upstream code on `status`. ALWAYS carry
  the provider's own status on `status` when mapping adapter errors, as
  `GitHubRequestError` does. (`server/src/platform/resilience.ts:35`,
  `server/src/adapters/github/octokit.ts:26`)

- 2026-10-17 — a repository that aggregates over tables another module owns (skill stats read `agent_runs`, `reviews`, `findings`) must use the typed Drizzle builder with the shared `db/schema` tables, never `db.execute(sql\`… raw names …\`)`: `arch:check` only sees imports, so a raw string breaks at runtime when a column is renamed, while a typed query fails `tsc` (checked by renaming `findings.acceptedAt`: error at `skill-stats.repo.ts`). Short `sql` fragments are fine when they interpolate typed columns (`count(*) filter (where ${t.agentSkills.enabled})`); use `countDistinct`/`count` + `.mapWith(Number)` so counts arrive as numbers, not bigint strings. (`server/src/modules/skills/repository/skill-stats.repo.ts`)
- 2026-10-17 — migration `0011` adds `UNIQUE(workspace_id, name)` to `skills` with no dedupe step, on purpose: before it nothing created skills (the only `INSERT` into `skills` is `SkillRepository.insert`), so no database can hold duplicate names, and editing an applied migration is forbidden. If a database ever fails `db:migrate` at `0011` with a duplicate-key error (skills inserted by hand), clean the duplicates in the data and re-run — do not edit `0011`. A `pr-self-review` waiver cannot silence this WARNING: `waivers.mjs` only applies to CRITICAL findings, so it stays in the report as accepted. (`server/src/db/migrations/0011_rare_carnage.sql`, `.claude/skills/pr-self-review/scripts/waivers.mjs`)

## Tool & Library Notes
- 2026-10-12 — the installed dependency-cruiser (17.4.3) has no `--baseline`
  flag even though the current online CLI docs describe it, and
  `depcruise-baseline` is a deprecated alias. Write the known-violations file
  with `-T baseline --output-to .dependency-cruiser-known-violations.json`
  (wrapped as `pnpm arch:baseline`) and read it with `--ignore-known`. The
  `err-long` reporter prints each rule's `comment`, so put the fix in the
  comment. (`server/package.json`, `server/.dependency-cruiser.cjs`)
- 2026-10-12 — macOS (BSD) `grep` and `file` classify some TS files in this
  repo as binary (`file` says `data`; UTF-8 em-dashes in comments), and
  `grep -r` then SILENTLY drops their matches — a search for importers of
  `repo-intel/constants` missed `adapters/depgraph/index.ts` entirely. Use
  `grep -a` (or ripgrep) for any "who uses X" search before moving code.
  (`server/src/adapters/depgraph/index.ts:20`)

- 2026-10-16 — `pnpm` is not on PATH in some shells, and the lockfile/`node_modules`
  here were written by pnpm 12.4.1: `npx -y pnpm@10 add …` fails with "node_modules was
  installed with a different major version", and `pnpm@12.4.1 add` reformats
  `engines` in `package.json` (restore that line by hand to keep the diff clean).
  Use `npx -y pnpm@12.4.1 <cmd>`. (`server/package.json`)

## Recurring Errors & Fixes

- 2026-09-21 — `seed.ts`'s PR #482 review+findings block only runs inside
  `if (!pr)` (`db:seed`'s "idempotent" claim covers workspace/user/settings,
  not this fixture). Re-running `pnpm db:seed` against a DB that already has
  PR #482 will NOT add findings appended to that block in code — the review
  row already exists so the insert is skipped entirely. To see a new seeded
  finding on an existing dev DB, insert it by hand (or drop the PR's review
  row) rather than just re-seeding. (`server/src/db/seed.ts:99`)

- 2026-10-16 — `agent_runs.status` is `'done'` (not `'completed'`); a raw-SQL rollup
  filtering on the wrong word silently returns nothing. (`server/src/modules/skills/repository/skill-stats.repo.ts`)

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
