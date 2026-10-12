# Legacy baseline — known violations (as of 2026-10-12)

`server/.dependency-cruiser-known-violations.json` holds 34 violations that
existed when the rules were introduced. `pnpm arch:check` ignores them so it can
fail on **new** violations only. See them with:

```bash
cd server && pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs --no-ignore-known
```

## Policy: fix on touch

- **Don't copy these as patterns.** Code next to a violation is not evidence
  that the violation is fine.
- **Fix it when you're changing that code anyway** — the same function, handler
  or import. Then run `pnpm arch:baseline` and check that the baseline diff only
  *removes* entries.
- **Don't open refactor-only PRs across modules** for these unless the user asks.
- **Never add an entry to the baseline** to make a new change pass. If a rule
  seems wrong for a genuinely new case, raise it — the fix is a rule change with
  a reason recorded in `server/specs/onion-architecture.md`, not a baseline row.

## What's in it and how to fix each kind

| Where | Rule(s) | Fix when touched |
|---|---|---|
| `pulls/routes.ts`, `settings/routes.ts`, `polling/routes.ts`, `workspace/routes.ts` — Drizzle queries via `container.db` | `routes-are-thin`, `db-only-in-repositories` | move queries to `repository/*.repo.ts`, orchestration to `service.ts`, decisions to `helpers.ts`/`status.ts` (see fastify-and-zod.md) |
| `settings/feature-models.ts` — Drizzle in a non-repository file | `db-only-in-repositories` | move the query into a settings repository |
| `reviews/run-executor.ts`, `reviews/diff-loader.ts` — value import of `db/schema` | `db-only-in-repositories` | use `ReviewRepository` methods; keep row types as `import type` from `db/rows.ts` |
| `repos/helpers.ts` — imports `db/schema` | `domain-is-pure`, `db-only-in-repositories` | the helper should take plain values; move the table-dependent part to the repository |
| `repo-intel/service.ts`, `repo-intel/pipeline/{full,incremental}.ts` — import `adapters/astgrep`, `adapters/codeindex/extract` | `modules-use-ports-not-adapters` | expose parsing through a port on the container (like `depgraph`/`tokenizer`), or move pure parsers next to the pipeline |
| `repo-intel/pipeline/repo-map.ts` — imports `adapters/tokenizer` (the `Tokenizer` type lives there) | `modules-use-ports-not-adapters` | move the `Tokenizer` interface to `vendor/shared/adapters.ts` or `repo-intel/types.ts` |
| `reviews/diff-loader.ts` — imports `adapters/git/diff-parser` | `modules-use-ports-not-adapters` | expose `parseUnifiedDiff` through `GitClient` or move it to `vendor/shared` as a pure function |
| `adapters/astgrep/index.ts`, `adapters/depgraph/index.ts` — import `modules/repo-intel/constants` | `adapters-dont-know-modules` | move the shared constants (`SUPPORTED_EXT`, `MAX_SIGNATURE_CHARS`, …) into the adapter or `vendor/shared` |
| `repos/service.ts` → `repo-intel/constants.ts` | `no-cross-module-internals` | import via `repo-intel/index.ts` or move the constant to `vendor/shared` |
| `pulls/routes.ts` → `reviews/helpers.ts` (`findingRowToDto`) | `no-cross-module-internals` | go through `container.reviewRepo` + a mapper in `modules/_shared` or a reviews facade |

## Not in the baseline file (not statically detectable) but still legacy

- Services that take the whole `Container` and do
  `new XRepository(container.db)` / `this.container.llm(...)` inside
  (`agents/service.ts`, `repos/service.ts`, `reviews/service.ts`,
  `repo-intel/service.ts`). New services use constructor injection
  (di-and-adapters.md).
- `container.db` used directly in route handlers beyond the imports listed
  above.
- `repo-intel/index.ts` re-exports routes and the repository — a barrel, not a
  narrow facade. Prefer the `RepoIntel` interface from `types.ts`.
