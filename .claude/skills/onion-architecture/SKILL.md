---
name: onion-architecture
description: "Onion (ports & adapters / clean) architecture for the DevDigest backend — server (Fastify 5, Zod, Drizzle + Postgres, DI container, Octokit, simple-git, OpenAI/Anthropic SDKs, ripgrep/ast-grep) and reviewer-core (the pure review engine). Says which ring every file is in, what it may import, where new code goes, and how `pnpm arch:check` (dependency-cruiser) enforces it. Use this skill whenever you add or change a module, route, service, repository, adapter, port or helper under server/src or reviewer-core/src; move logic between files; add an external integration (a new SDK, API, queue, notifier); answer where-should-this-live questions (route or service? helper or service? repository or adapter? does this belong in reviewer-core?); see an arch:check failure; or review a backend PR for structure, layering or dependencies — even if nobody says architecture. Not for Fastify API details (fastify-best-practices), Drizzle query syntax (drizzle-orm-patterns), table design (postgresql-table-design) or Zod API (zod)."
metadata:
  version: 1.0.0
  updated: 2026-10-12
  tags: onion-architecture, hexagonal, clean-architecture, ports-and-adapters, fastify, drizzle, zod, dependency-injection, dependency-cruiser, backend
---

# Onion Architecture — DevDigest backend

Where backend code lives and which way its dependencies point. The rules are
tailored to this repo's tools; `#N` cites a source in
[references/sources.md](references/sources.md) (links also in [README.md](README.md)).

**Scope.** `server/src/**` and `reviewer-core/src/**`. For framework/library
mechanics use the neighbouring skills: `fastify-best-practices`,
`drizzle-orm-patterns`, `postgresql-table-design`, `zod`. This skill decides
*where* code goes; they decide *how* to write it there.

## How to use this skill

- **Placing new code** → find the row in §3, check the ring's import rules in §2,
  then open the matching reference file for that tool.
- **`pnpm arch:check` failed** → the rule name tells you the ring that was
  crossed; [references/enforcement.md](references/enforcement.md) explains each
  rule and the fix. Move the code; don't loosen the rule.
- **Touching a file that already breaks a rule** → [references/legacy-baseline.md](references/legacy-baseline.md).
  Don't copy the pattern; fix it if the change is in that area anyway.
- **Reviewing a backend PR** → run the §8 checklist.
- **Before finishing any backend change** → `cd server && pnpm arch:check`
  alongside `pnpm typecheck` and the unit run.

| Read this reference | When |
|---|---|
| [fastify-and-zod.md](references/fastify-and-zod.md) | writing or reviewing `routes.ts`, request/response schemas, errors → HTTP |
| [drizzle-and-repositories.md](references/drizzle-and-repositories.md) | any SQL, a new repository method, row→DTO mapping, transactions |
| [di-and-adapters.md](references/di-and-adapters.md) | a new SDK/integration, a port, the Container, service constructors, tests per ring |
| [reviewer-core.md](references/reviewer-core.md) | any change in `reviewer-core/src` or in how server calls it |
| [legacy-baseline.md](references/legacy-baseline.md) | the file you're in shows up in `arch:check --no-ignore-known` |
| [enforcement.md](references/enforcement.md) | an `arch:check` error, changing the rules, refreshing the baseline |
| [sources.md](references/sources.md) | you need the reasoning behind a rule or must justify it in review |

---

## 1. Principles

1. **Dependencies point inward.** Source code may depend on rings closer to the
   centre, never further out (#1, #3). "The database is not the center. It is
   external" (#1) — so are Fastify, GitHub, git, the LLM providers and the disk.
2. **The core owns the ports.** The inside declares the interface it needs; the
   outside implements it and is plugged in at the composition root (#1, #2, #6).
   A port describes what the core needs, not the tool's API (#5).
3. **Plain data crosses boundaries.** Zod contracts / DTOs and plain values go
   in and out of a ring — not Drizzle tables, not `FastifyRequest`, not SDK
   objects (#3, #9).
4. **Functional core, imperative shell.** A use case is an impure → pure →
   impure sandwich: load what you need, call pure functions to decide, then
   write/send the result (#8). Pure code is where the business rules live and is
   trivially testable.
5. **Flat core, isolated modules.** Feature modules don't reach into each
   other's files; they meet through the Container, a facade, or the shared
   kernel (#4, #5).
6. **Abstract real boundaries only.** A port exists where there is something
   external to swap or fake (#14, #15). We don't wrap Drizzle in a second
   repository interface, and we don't add a DI framework on top of the Container.

Why it matters here: the review pipeline must run hermetically in tests (mock
LLM, mock GitHub via `ContainerOverrides`), `reviewer-core` must also run in CI
without a DB, and every one of the 8 course lessons adds a module — each must
be addable without touching the others.

## 2. The rings in DevDigest

| Ring | Files | May import |
|---|---|---|
| **0 Shared kernel** — contracts + ports | `server/src/vendor/shared/**` (Zod wire contracts, `adapters.ts` ports) | `zod` only |
| **0′ Pure engine** | all of `reviewer-core/src` except `llm/` | ring 0, other reviewer-core files; never `node:fs`, DB, GitHub, server code |
| **1 Domain logic** (pure) | `modules/<m>/helpers.ts`, `status.ts`, `constants.ts` | rings 0, 0′ (public API), `platform/errors.ts`; *types* from `db/rows.ts` for mappers |
| **2 Application** (use cases) | `modules/<m>/service.ts`, `run-executor.ts`, `findings.ts`, `diff-loader.ts`, `repo-intel/pipeline/*` | rings 0–1, ports, own repository, `platform/*` cross-cutting (errors, run-logger, jobs) |
| **3a Driven adapters** | `modules/<m>/repository.ts`, `repository/*.repo.ts`, `src/adapters/**`, `src/db/**`, `reviewer-core/src/llm/**` | rings 0–1, Drizzle, SDKs, Node I/O |
| **3b Driving adapters** | `modules/<m>/routes.ts`, `modules/_shared/context.ts`, `platform/sse.ts` | rings 0–2 (call the service), Fastify, zod |
| **Composition root** | `src/app.ts`, `src/server.ts`, `src/modules/index.ts`, `src/platform/container.ts` | everything — the only place concretes meet ports |

`platform/{config,errors,jobs,run-logger,sse,…}` is cross-cutting
infrastructure. Only `container.ts` may import feature modules.

Two deliberate exceptions (see `server/specs/onion-architecture.md`):
- **Row types may cross as `import type`.** `src/db/rows.ts` exists so code can
  name a row shape without importing a data layer; `toXDto(row)` mappers take
  them. A *value* import of `db/schema*` or `drizzle-orm` outside ring 3a is a
  violation.
- **`platform/errors.ts` is shared.** `AppError` & co. are the domain error
  taxonomy; the single `setErrorHandler` in `app.ts` maps them to HTTP.

## 3. Where does this code go?

| You're writing… | Put it in | Not in |
|---|---|---|
| A rule or calculation over findings / reviews / runs (score, rollup, status) | `helpers.ts` / `status.ts` — a pure function over contracts | the route, the SQL, the service body |
| A use case: load → decide → persist/notify | `service.ts` method (the sandwich, §1.4) | `routes.ts` |
| A SQL query, insert, upsert, aggregate | `repository/<entity>.repo.ts` function taking `db: Db` first | service, route, helper |
| Row → wire DTO mapping | `toXDto(row)` in `helpers.ts` (row typed via `import type`) | inside the SQL function, inside the route |
| Request validation | Zod `schema.params/body/querystring` on the route (`fastify-type-provider-zod`) | `Schema.parse(req.body)` in the handler, the service |
| A call to an external SDK/API (GitHub, git, LLM, embeddings, Slack…) | a port in `vendor/shared/adapters.ts` + impl in `src/adapters/<kind>/<impl>.ts` + wiring in `container.ts` + `ContainerOverrides` entry | a module, a route |
| Choosing which implementation to use / reading a secret | `platform/container.ts` | a service (`new OpenAIProvider(key)`) |
| Translating an error to an HTTP status | throw an `AppError` subclass; `app.ts` error handler maps it | `reply.status(…)` in a service |
| Prompt assembly, grounding, scoring, diff slicing | `reviewer-core` (and export it from `src/index.ts`) | server modules |
| Something two modules both need | `modules/_shared/` (presentation helpers) or `vendor/shared` (contracts) | importing the other module's file |
| Data another module owns | that module's repository via the Container (`container.agentsRepo`) or its `index.ts` facade | your own query against its tables |

## 4. Fastify + Zod — the driving side (ring 3b)

Details and examples → [references/fastify-and-zod.md](references/fastify-and-zod.md).

- A route handler does three things: read the request context
  (`getContext`), call **one** service method with typed input, return the DTO.
  Branching business logic in a handler belongs in the service (#3, #15).
- Declare `params`/`body`/`querystring` (and preferably `response`) as Zod
  schemas via `withTypeProvider<ZodTypeProvider>()` — parse at the edge, so the
  inside receives already-valid data (#13, #20).
- No `drizzle-orm`, `db/schema`, `container.db`, repositories or adapters in a
  route. The rule catches the imports; `container.db` without an import is
  caught only by review (§8).
- Each module is an encapsulated Fastify plugin registered in
  `modules/index.ts`. Use `fastify-plugin` only for genuinely cross-cutting
  plugins; `decorate` only the `container` (#17, #18).
- Build the app in `buildApp()` and test routes with `app.inject()` (#19).

## 5. Drizzle + Postgres — the driven side (ring 3a)

Details and examples → [references/drizzle-and-repositories.md](references/drizzle-and-repositories.md).

- `drizzle-orm`, `postgres` and the table objects in `db/schema*` are imported
  only by `repository.ts` / `repository/*.repo.ts` and `src/db/**`.
- A repository is a collection-like API in domain language —
  `listByIds`, `latestReviewPerAgent`, `completeAgentRun` — not a generic
  `query(sql)` (#10). It returns rows (typed via `db/rows.ts`) or plain shapes;
  the service maps them to DTOs with helpers.
- Repo functions take the executor (`db: Db`) as the first argument, which is
  what makes transactions composable: the service opens
  `db.transaction(async (tx) => …)` through a repository method and passes `tx`
  down (#22).
- Aggregation that SQL does naturally (GROUP BY, SUM) may live in SQL; business
  decisions (what counts as "latest", null-vs-zero) live in pure helpers so they
  are unit-testable without a DB — see `pulls/status.ts`.

## 6. DI container, ports and external SDKs

Details and examples → [references/di-and-adapters.md](references/di-and-adapters.md).

- `platform/container.ts` is the composition root (#6). It picks the concrete
  class, resolves secrets lazily, and is the only place that `new`s an adapter.
- Services receive their collaborators through the constructor — the
  repository, the ports they use — instead of reaching into the whole
  `Container` (Service Locator hides dependencies, #12). New services should do
  this; existing ones that take `Container` are in the baseline.
- Every SDK (`octokit`, `simple-git`, `openai`, `@anthropic-ai/sdk`,
  `@vscode/ripgrep`, `@ast-grep/napi`, `dependency-cruiser`, `js-tiktoken`) is
  imported only under `src/adapters/**` (or `reviewer-core/src/llm/**`).
- Adding an adapter = 4 steps (`server/docs/di-container.md`): port in
  `vendor/shared/adapters.ts` → impl in `src/adapters/<kind>/` → construct in
  the container (lazily if it needs a secret) → add to `ContainerOverrides`.
  Skipping the last step makes every test hit the real thing.

## 7. reviewer-core — the pure engine

Details → [references/reviewer-core.md](references/reviewer-core.md).

- No DB, GitHub, FS, child processes or HTTP server. The only side effect is the
  injected `LLMProvider` port. The `openai` SDK is allowed only in `src/llm/`.
- Contracts come from `@devdigest/shared`, which resolves to
  `server/src/vendor/shared` — the shared kernel. Change them in sync with the
  client copy.
- Its public API is `src/index.ts`; server imports `@devdigest/reviewer-core`,
  never a deep path.
- If a change needs I/O (reading a file, a repo map, git history), server loads
  it and passes the data in as an argument — that is what the optional prompt
  slots (`skills`, `memory`, `specs`, `callers`) are for.

## 8. Review checklist

Each item names the rule (§) it protects.

1. Does `pnpm arch:check` pass, and does `.dependency-cruiser-known-violations.json`
   only *lose* entries in this diff? (enforcement)
2. Is every new route handler just context → service call → DTO? Any
   `container.db`, `drizzle-orm`, repository or adapter in a route? (§4)
3. Are request inputs Zod schemas on the route, not hand-parsed? (§4)
4. Is every new SQL statement in a `repository/*.repo.ts` function that takes
   `db` first? (§5)
5. Are business decisions in pure helpers with unit tests, not in SQL or the
   handler? (§1.4, §5)
6. Does any helper/status/constants file import a value from `db`, `adapters`,
   `platform` (other than `errors.ts`), Fastify or an SDK? (§2)
7. Does any new code import an SDK outside `src/adapters/**`, or a concrete
   adapter class outside `container.ts`? Is the new adapter in
   `ContainerOverrides`? (§6)
8. Does a new service take narrow constructor dependencies rather than the whole
   `Container`? (§6)
9. Does any module import another module's internal file? (§3, §6)
10. Does any `reviewer-core` change add I/O, server imports or a deep import from
    server? (§7)
11. Does any service set an HTTP status or build a `reply`? (§3)

**Anti-patterns to name in review:** fat route handler · Drizzle row or table
leaking into a DTO · SDK client constructed inside a service · Service Locator
(`this.container.x` scattered through a service) · an interface with one
implementation and no test double · cross-module deep import · baseline grown
to make CI green.

On anemic models: Fowler warns that moving all logic into services "robs" the
domain model (#11). We deliberately use a *functional* core instead of rich
entities — contracts are plain Zod data and the rules live in pure helper
functions (#8, #9). The anti-pattern to avoid here is therefore not "logic
outside entities" but "logic outside pure functions": rules buried in services,
routes or SQL.
