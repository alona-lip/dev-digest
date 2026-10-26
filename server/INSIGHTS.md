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

- 2026-10-21 — telling "with / without skills" runs apart by agent `config.version` only works
  for the per-agent switch: `replaceSkills` bumps the version when the set of bound+enabled
  skill ids changes, but the global `skills.enabled` toggle (Skills → card) also changes the
  prompt and bumps NOTHING. Seen in the skills experiment: Test Quality runs `05b77db7`
  (3 skill blocks) and `f0bbf4ed` (2 blocks, `test-smells` off globally) both report
  `config.version` 8. ALWAYS compare runs by `prompt_assembly.skill_blocks` in
  `GET /runs/:id/trace` (or `run_skills`), never by version alone.
  (`server/src/modules/agents/repository.ts:345`, `docs/skills-experiment.md` Checks)
- 2026-10-21 — a renamed field in a request contract (`RunRequest.agentId` → `agent_id`,
  experiment PR alona-lip/dev-digest#4) yields NO callers digest: there is no changed callable
  signature to look up, so the trace's `prompt_assembly.callers` is empty and the log has no
  `callers digest:` line. The client caller (`useRunReview`) reached the model only through
  the repo map. NEVER count on the callers digest for wire-shape changes; the repo must be
  indexed (repo map present) or the reviewer can only say "any existing caller".
  (`docs/skills-experiment.md` B results)
- 2026-10-23 — a review run reaches more LLMs than the agent's own: the executor now derives the
  PR intent first on the `review_intent` feature model (default `openrouter`). A test that only sets
  `overrides.llm = { openai: mock }` does not fail — `container.llm('openrouter')` falls back to the
  developer's REAL key in `~/.devdigest/secrets.json` / env and makes a paid call (or, keyless, the
  intent is silently skipped). ALWAYS mock every provider a run can reach, incl. feature models
  (`openrouter: new MockLLMProvider('openai', { structuredBySchema: { Intent: … } })`).
  (`server/test/reviews.it.test.ts`, `server/test/skills.it.test.ts`)
- 2026-10-25 — `pr_files` is NOT a reliable list of a PR's changed files: it is written only when
  someone opens PR detail (`GET /pulls/:id` → `replaceDetail`) — on the indexed dev-digest repo 3 of
  136 PRs had rows. `loadDiff` does not save you either: fork-PR heads are not in the clone (only
  `main` is fetched), so `git diff base...head` throws and it falls back to the same empty
  `pr_files`. A feature reading changed paths from either alone silently reads "nothing changed"
  (blast radius showed 0 symbols, `degraded: false`, for most PRs and every MCP call). ALWAYS
  resolve changed paths as loadDiff → GitHub `getPullRequest(...).files` → `[]`.
  (`server/src/modules/blast/service.ts` `prChangedFiles`)
- 2026-10-25 — supersedes the entry above on the LAST step only: when the local diff is empty
  AND the GitHub file-list lookup fails, do NOT fall back to `[]` — repo-intel treats an empty
  `changedFiles` as a healthy "nothing changed", so a dead token showed a clean 0-symbol map with
  no log. ALWAYS log the failure and fail loudly (`ExternalServiceError`, 502); the global error
  handler does not log `AppError`s, so log before throwing.
  (`server/src/modules/blast/service.ts` `changedFiles`, `server/src/app.ts:170`)

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

- 2026-10-19 — `container.git.readFile` joins the path onto the clone with no `..` / symlink
  guard (`server/src/adapters/git/simple-git.ts:198`), so it is unsafe for any path derived from
  repo content or a model. Feature code reads clone files through
  `repoIntel.readRepoFile(repoId, path)` (realpath check via `readClone`, null when the file is
  missing or escapes the clone; not gated by `REPO_INTEL_ENABLED`). Note also that
  `getConventionSamples` returns repo-relative PATHS only and filters configs out (eslint,
  prettier, `*.config.*`), so a caller that wants configs must list them itself.
  (`server/src/modules/repo-intel/service.ts:636`)
- 2026-10-19 — a module that needs to write another module's data goes through that module's
  `index.ts` facade, never its repository: conventions saves `repo-conventions` via
  `skills/index.ts` → `SkillsService.upsertByName` (create, or the next body version), so
  versioning and name-clash rules live in one place; feature models come from
  `settings/index.ts` → `resolveFeatureModel`. A new service takes narrow constructor deps and
  is wired by a `createXService(container)` factory in its own `service.ts`, because a route may
  not import a repository. (`server/src/modules/conventions/service.ts:197`)

- 2026-10-20 — the skill prompt-injection scan is a gate on STORED config, separate from
  `INJECTION_GUARD` (skills are deliberately not wrapped as untrusted, decision L3), so it does
  not break the "guard is not a keyword filter" rule. On update, a NEW flagged body is forced
  `enabled = false` rather than rejected, because conventions writes through
  `SkillsService.upsertByName` and must never fail on it; only `enabled: true` on an UNCHANGED
  flagged body is a 422. Re-scan's model call runs outside the transaction, and the write
  compares `version` and throws `ConflictError` if the body changed meanwhile. NEVER let the
  LLM verdict clear a pattern hit. (`server/src/modules/skills/service.ts`, `server/specs/skill-injection-scan.md`)

- 2026-10-21 — conventions triage now has three states: a new candidate is `PENDING`, not
  `ACCEPTED`. This supersedes the "new = ACCEPTED, no PENDING" choice in `specs/conventions.md`,
  which let "Create skill" show right after a scan with nothing accepted (HW criterion 50).
  Migration `0015` only changes the column default; rows that existed earlier keep their status.
  ALWAYS gate anything skill-related on `ACCEPTED` (`listAccepted`), never on "not REJECTED".
  (`server/src/db/migrations/0015_graceful_stone_men.sql`, `server/specs/conventions-pending-status.md`)
- 2026-10-21 — the conventions repo has two list reads on purpose: `listOpen` (no `REJECTED`)
  feeds `GET /repos/:id/conventions`, and `listByRepo` (every row) feeds the extract dedupe.
  NEVER switch the dedupe to `listOpen`: rejected rules would come back as fresh `PENDING`
  candidates on every re-scan (HW criterion 48). `conventions.it.test.ts` "a rejected rule leaves
  the list…" guards it. (`server/src/modules/conventions/service.ts:124`,
  `server/src/modules/conventions/repository/convention.repo.ts`)
- 2026-10-23 — when two modules need each other (intent reuses reviews' `loadDiff`; the reviews run
  executor needs the intent), direct imports break `no-cross-module-internals` and `no-circular`.
  The edge that goes "backwards" goes through the composition root: `container.intent` is a lazy
  getter built by `createIntentService(container)`, and `reviews` calls
  `this.container.intent.forRun(...)` without importing the intent module; `intent` imports
  `loadDiff` only via the `reviews/index.ts` facade. ALWAYS resolve such a pair this way (as
  `repoIntel` already is) instead of moving code into `_shared`. (`server/src/platform/container.ts`,
  `server/src/modules/reviews/index.ts`)
- 2026-10-25 — prior PRs (`GET /pulls/:id/blast/history`) are a SEPARATE route, not a field on
  `GET /pulls/:id/blast`: the map must stay an index-only read (HW P2 "logs show the index read") and
  MCP `get_blast_radius` must return the same GitHub-free map as the card; a GitHub outage then only
  blanks the Prior PRs block. The data is ONE GitHub GraphQL call (an aliased `history(path:)` per
  changed file → `associatedPullRequests`), because `pr_files` covers 3 of 136 PRs and the clone is
  shallow (`CLONE_DEPTH = 1`), and REST `pulls.list` + `listFiles` per PR would be 50+ calls per open.
  ALWAYS add GitHub-backed extras to the blast card as their own route. (`server/src/modules/blast/service.ts`,
  `server/src/adapters/github/octokit.ts`, `specs/blast-radius.md` "Prior PRs follow-up")

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

- 2026-10-19 — `pnpm db:generate` (drizzle-kit, `strict: true`) asks interactively whether a
  dropped column was RENAMED when the same schema change both adds and drops columns of one
  table (here: add `conventions.status`, drop `accepted`). Without a TTY it waits for an
  answer nobody can give. Split such a change into two generate runs — add first, then drop /
  tighten — which is why `0012_vengeful_slapstick.sql` (ADD COLUMNs + index) and
  `0013_melodic_network.sql` (SET NOT NULL + DROP COLUMN) are separate.
  (`server/src/db/migrations/0013_melodic_network.sql`)

- 2026-10-20 — `node:https` does NOT call a custom `lookup` when the URL host is an IP
  literal, so an SSRF check placed only in `lookup` lets `https://169.254.169.254/` and
  `https://[::1]/` straight through. Check literal hosts with `net.isIP` before the request,
  AND keep the `lookup` check for hostnames (it sees the address the socket actually connects
  to, so DNS rebinding can't swap it). `net.BlockList` does not unwrap IPv4-mapped IPv6
  (`::ffff:7f00:1` = 127.0.0.1); unwrap it by hand first. (`server/src/adapters/http/safe-fetch.ts`)
- 2026-10-25 — repo-intel index limits that shape blast radius: (1) endpoint facts are extracted
  per LINE (`server/src/modules/repo-intel/extract.ts:15`) — `app.get(` with the path on the next line
  (intent, repo-intel routes) yields no endpoint; (2) callers are DIRECT resolved references only —
  `BFS_DEPTH` is used by `getCriticalPaths`, not by `getBlastRadius`, so a helper called from a
  `service.ts` shows no endpoints; (3) `repo_too_large` is never stamped — the walk keeps the first
  5000 files and the index stays `full` (`pipeline/walk.ts:65`). For a demo PR, change an EXISTING
  function imported by single-line `routes.ts` files (e.g. `getContext` → 8 callers, 27 endpoints).
- 2026-10-25 — refines the 2026-10-12 `withRetry` entry for Octokit GraphQL: `hook.error('request')`
  maps only HTTP failures; a GraphQL error (HTTP 200 + `errors`, `GraphqlResponseError`) has NO
  `status` to carry, so "keep the upstream code on `status`" does not apply. Mapping it to
  `ExternalServiceError` INSIDE the `withRetry` callback made deterministic errors (repo not found,
  missing scope) retryable via `statusCode` 502 — 4 attempts × 30s timeout before the 502. ALWAYS let
  `withRetry` wrap only the raw `octokit.graphql` call and map to `ExternalServiceError` after the loop.
  Guarded by `github-path-history.test.ts` "…without retrying it" (expects exactly 1 call).
  (`server/src/adapters/github/octokit.ts` `listPathPullRequests`, `server/src/platform/resilience.ts:35`)

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

- 2026-10-20 — a body that fails the route's zod schema returns **422**, not 400 (same as
  `ValidationError` from a service). A test expecting 400 for "not a url" fails; assert 422.
  (`server/test/skills.it.test.ts`, `import from URL` block)

- 2026-10-21 — `seed.ts` binds the `docs/skills-examples` skills only to an agent with ZERO
  `agent_skills` rows, and only then creates its skills. A dev DB where someone already bound
  anything (this one had the old `route-breaking-change` + `contract-compat` set) gets nothing
  from a re-seed, and an edited skill file never reaches an existing skill. To get the seeded
  set, clear that agent's links on the Skills tab (and delete the stale skills) and re-seed.
  Seed reads the files via `import.meta.url` → `../../../docs/`, so it only works from a full
  checkout on the host. (`server/src/db/seed.ts`, `server/specs/seed-skill-bindings.md`)

- 2026-10-21 — supersedes the path note in the entry above: `seed.ts` is ALSO bundled into
  `dist/server.js` (`src/adapters/auth/local.ts` imports its constants), so an
  `import.meta.url`-relative path in it resolves from `server/dist/`, not `server/src/db/`.
  It now reads `docs/skills-examples` via `process.cwd()` (= `server/`). NEVER resolve files
  in seed.ts from `import.meta.url`. Also: bind skills through `AgentsRepository.replaceSkills`,
  never by inserting into `agent_skills` directly, or the agent version is not bumped
  and its `agent_versions` snapshot lists no skills.
  An agent cleared of ALL links is re-bound by the next seed (no tombstone; see the spec's
  Known limitation). (`server/src/db/seed.ts`, `server/specs/seed-skill-bindings.md`)

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
- 2026-10-21 — an example caller written in a skill body is repeated by the model as a fact:
  `breaking-change` lists "the web client in `client/`, the CI runner, `reviewer-core`" as
  callers to check, and 2/3 runs with that skill on PR #4 named `reviewer-core` as a broken
  caller although it has no copy of `RunRequest` and never calls the route (0/3 without the
  skill). Open: should skill examples avoid naming concrete modules, or should the rubric
  say "only report a caller you can cite from the diff / repo map"? (low confidence, n=3,
  one model) (`docs/skills-examples/api-contract/breaking-change.md`, `docs/skills-experiment.md`)
