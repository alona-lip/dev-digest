# Onion baseline burn-down (wave 2)

Status: done for the baseline (2026-10-12) — 34 → 0, `.dependency-cruiser-known-violations.json` is `[]`.

Fix the legacy layering violations recorded in
`.dependency-cruiser-known-violations.json` (34 on 2026-10-12) as one
deliberate pass, requested by the user after the skill-driven audit — instead
of the default "fix on touch" policy in `onion-architecture.md`. No DB schema or
migration change; behaviour of every route stays the same except where noted.

## Order (largest baseline reduction first)

1. **pulls** — the 250-line `GET /repos/:id/pulls` handler becomes
   `PullsService.listForRepo` over `pulls/repository.ts`; `GET /pulls/:id`
   becomes `PullsService.detail`, whose files/commits refresh is one
   transaction. GitHub → `pull_requests` upsert is one repository function
   (`upsertFromGitHub`) shared with `polling`. Pure mapping (row → `PrMeta`,
   per-agent groups) lives in `pulls/helpers.ts`. `findingRowToDto` moves to
   `modules/_shared/` (it was a cross-module import from `reviews`).
2. **settings / polling / workspace** — queries move to repositories; routes
   only call a service.
3. **repo-intel ↔ adapters** — the `Tokenizer`/`DepGraph` ports and the
   parsing helpers move out of `src/adapters/**` into the shared kernel; the
   adapters stop importing `repo-intel/constants`.
4. **`db/schema` value imports** outside repositories become `import type` from
   `db/rows.ts`.
5. **Service Locator → constructor injection** where a service is touched.
6. **`ContainerOverrides`** gains `priceBook` so tests never reach OpenRouter.

## Behaviour changes (intended)

- `polling` now records `opened_at` for newly imported PRs, like the list
  route — the two hand-written upserts had drifted (INSIGHTS 2026-09-20).
- `GET /pulls/:id`: a DB error while refreshing files/commits no longer
  leaves the PR with its files deleted and serves the empty set; the refresh
  rolls back and the persisted detail is served.

## Rejected alternatives

- **A new `PullsRepository` interface + in-memory fake** — repositories are
  tested against real Postgres (`*.it.test.ts`); an interface with one
  implementation is the anti-pattern the skill names.
- **Splitting each route file into one file per handler** — not the module
  convention (`routes.ts` per module); the handlers become 3–5 lines anyway.

## Acceptance criteria

- `pnpm arch:check --no-ignore-known` shows fewer violations after each step;
  `pnpm arch:baseline` diffs only remove entries.
- `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration` pass after each
  step (`pulls-list.it.test.ts` pins the list rollups end to end).

## Result (2026-10-12)

- Baseline 34 → **0**; `pnpm arch:check --no-ignore-known` is clean.
- New shapes to copy: `pulls/{repository,service,helpers}.ts` (service with
  narrow deps: repository + lazy GitHub port + logger), `polling/service.ts`
  and `settings/service.ts` (shared repositories via the container:
  `pullsRepo`, `settingsRepo`, `reposRepo`), `modules/_shared/findings.ts`.
- Shared kernel grew two files: `vendor/shared/diff.ts` (`parseUnifiedDiff`,
  moved from `adapters/git`) and `vendor/shared/code-parser.ts` (`CodeParser`
  / `Tokenizer` ports + `SUPPORTED_EXT` / `MAX_SIGNATURE_CHARS`). repo-intel
  reaches ast-grep through `container.codeParser`; `extractEndpoints` /
  `extractCrons` moved next to repo-intel (`modules/repo-intel/extract.ts`).
- Also done: transactions in `AgentsRepository` (insert + v1 snapshot;
  update with the row locked — concurrent edits no longer lose a version;
  `setSkills`) and `deleteAgentRun`; workspace scoping for run cancel and run
  trace; `RunRequest` validated by the route schema (missing body → `{}`);
  `ContainerOverrides.priceBook`; shutdown drains jobs (≤10 s) before closing
  the pool; `RunBus` frees finished buffers after 10 min; reaper records why a
  run failed; N+1 agent-name lookup in `reviewsForPull` is one IN-query.

## Not done (next candidates)

- Service Locator remains in `agents`, `repos`, `reviews`, `repo-intel`
  services (they still take the whole `Container`) — move to narrow deps when
  touched, as `PullsService` shows.
- `response:` Zod schemas on routes — each needs a contract-vs-DTO audit first:
  a mismatch turns into a 500 at serialization time.
- Octokit `RequestError` → `ExternalServiceError` mapping in the GitHub adapter.
- `run.repo.ts` / `pull.repo.ts` (reviews) still build wire DTOs in SQL
  functions; the indexer's replace operations still run without a transaction
  or a per-repo advisory lock.
