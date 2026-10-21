# Drizzle + Postgres — repositories (ring 3a)

The database is a detail at the edge of the onion (#1). In this codebase the
edge is a module's `repository.ts` facade class plus the query functions under
`repository/*.repo.ts`.

## Shape

```ts
// repository/run.repo.ts — query functions, executor first
export async function activeRunsForPull(db: Db, workspaceId: string, prId: string) {
  const rows = await db.select({ … }).from(t.agentRuns).leftJoin(…).where(…);
  return rows.map(/* to a plain shape */);
}

// repository.ts — the facade the service sees (collection-like, domain names)
export class ReviewRepository {
  constructor(private db: Db) {}
  activeRunsForPull(workspaceId: string, prId: string) {
    return runRepo.activeRunsForPull(this.db, workspaceId, prId);
  }
}
```

Follow `modules/reviews/repository.ts` + `repository/{review,run,pull}.repo.ts`
for new modules. A small module may keep a single `repository.ts` (as `agents`
and `repos` do).

## Rules

- **Imports.** `drizzle-orm`, `postgres` and `db/schema*` are value-imported
  only by repository files and `src/db/**` (rule `db-only-in-repositories`).
  Other rings may `import type { AgentRow } from '../../db/rows.js'` — that file
  exists so row shapes can be named without importing a data layer.
- **Domain-named methods.** `listByIds`, `latestReviewPerAgent`,
  `completeAgentRun` — a collection-like interface (#10). No generic
  `run(query)` passthrough, no exposing the Drizzle builder to the service.
- **Return rows or plain shapes, map in helpers.** The repository returns
  `AgentRow` / plain objects; `toAgentDto(row)` in `helpers.ts` produces the wire
  DTO. Keep `$inferSelect`-derived types out of `vendor/shared` (#3, #23).
- **Workspace scoping is the repository's job.** Every read/write that a user
  can reach filters by `workspaceId`; the service passes it, the repository
  enforces it.
- **What may stay in SQL.** Filtering, joins, ordering, GROUP BY/SUM — the
  things the database does better. **What may not:** the decision about what the
  numbers mean (null vs zero, "latest per agent", which runs count). Those go in
  pure helpers so all their cases are unit-testable — see `sumRunCosts` and
  `latestReviewPerAgent` in `pulls/status.ts` and the server INSIGHTS entries of
  2026-09-23/27.
- **Projection drift.** A hand-written projection (destructure → pass
  field-by-field) silently drops new fields — that is how `costUsd` went
  unpersisted (INSIGHTS 2026-09-20). When adding a column, diff the domain
  shape against every insert/update call.
- **No FK assumptions in the domain.** `reviews.agent_id` is nullable with no
  FK; repositories must not inner-join it away (INSIGHTS 2026-09-27).

## Transactions — the unit of work belongs to the use case

The service decides what must be atomic; the repository provides the means.
Because query functions take the executor first, a transaction composes:

```ts
// db/client.ts — add once when first needed
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Executor = Db | Tx;

// repository/*.repo.ts — widen the first parameter from Db to Executor
export async function saveFindings(db: Executor, reviewId: string, rows: NewFinding[]) { … }

// repository.ts
export class ReviewRepository {
  constructor(private db: Executor) {}
  // On a Tx this opens a savepoint, so nesting is safe. (Type-checked 2026-10-12.)
  inTransaction<T>(fn: (repo: ReviewRepository) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(new ReviewRepository(tx)));
  }
}

// service.ts
await this.repo.inTransaction(async (repo) => {
  await repo.saveReview(…);
  await repo.saveFindings(…);
});
```

- `db.transaction(async (tx) => …)` commits when the callback resolves and rolls
  back when it throws; `tx.rollback()` aborts explicitly; nested
  `tx.transaction` uses savepoints (#22).
- Keep only DB work inside the callback. An LLM or GitHub call inside a
  transaction holds a pooled connection for seconds and starves the pool —
  load, call the LLM, then open the transaction to persist (the impureim
  sandwich, #8).
- `Tx` / `Executor` exist in `db/client.ts`. Reference implementations:
  `ReviewRepository.persistCompletedRun` (review + findings + run status in one
  transaction, opened after the LLM call) and the pulls repository's PR-detail
  refresh (delete + re-insert of files/commits).

## Migrations and schema

Out of scope here — see `drizzle-orm-patterns` / `postgresql-table-design`. The
global rule still applies: applied migrations under `src/db/migrations/**` are
immutable; a schema change is a new migration via `pnpm db:generate`.

## Testing

Repositories are tested against real Postgres via Testcontainers in
`server/test/*.it.test.ts` (Docker required). Don't mock Drizzle; don't add a
repository interface just to fake it in service tests — fake at the port
level (`ContainerOverrides`) or seed rows directly as
`server/test/pulls-list.it.test.ts` does.
