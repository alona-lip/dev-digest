# Onion architecture for server + reviewer-core

Status: implemented (2026-10-12).

Write the dependency rule down once, map it onto the files we already have, and
make the machine check it — so a new route, service or adapter lands in the
right ring without anyone having to remember the rule.

## Goal

1. One explicit answer to "which ring is this file in, and what may it import?"
   for every file in `server/src` and `reviewer-core/src`.
2. Enforcement that fails on **new** violations only, so it can be switched on
   today against a codebase that already has some.
3. Guidance the agent loads automatically: the `onion-architecture` skill
   (`.claude/skills/onion-architecture/`).

## Decisions

### Map the rings onto the existing role-named files

| Ring | Files |
|---|---|
| 0 Shared kernel (contracts + ports) | `src/vendor/shared/**`; `reviewer-core` as a whole is the pure engine |
| 1 Domain logic (pure) | `modules/<m>/{helpers,status,constants}.ts` |
| 2 Application (use cases) | `modules/<m>/service.ts`, `run-executor.ts`, other orchestration files |
| 3a Driven adapters | `modules/<m>/repository*`, `src/adapters/**`, `src/db/**`, `reviewer-core/src/llm/**` |
| 3b Driving adapters | `modules/<m>/routes.ts`, `platform/sse.ts` |
| Composition root | `src/app.ts`, `src/server.ts`, `src/modules/index.ts`, `src/platform/container.ts` |

**Rejected — explicit layer folders** (`modules/<m>/{domain,application,infrastructure,http}/`):
contradicts the role-named-file convention in `server/AGENTS.md` and every
existing module, and would mean either a big-bang move or two conventions side
by side. The file role already tells you the ring.

### Two deliberate exceptions

- **Row types may cross as types.** `src/db/rows.ts` exists precisely so modules
  can name a row shape without importing another module's data layer; the
  `toXDto` mappers in `helpers.ts` take those rows. A *type-only* import of
  `rows.ts` (or of the own repository's re-export) is allowed in rings 1–2.
  A value import of `db/schema*` or `drizzle-orm` is not.
- **`platform/errors.ts` is shared.** It is the declared domain error taxonomy
  (`AppError` and subclasses). Domain and application code may throw these; the
  single `setErrorHandler` in `app.ts` maps them to HTTP.

### Enforce with dependency-cruiser, ratchet with a baseline

`server/.dependency-cruiser.cjs` (canonical copy in the skill's `assets/`)
holds 17 rules. `pnpm arch:check` cruises `src` and `../reviewer-core/src`
with `--ignore-known`, so the 34 violations present on 2026-10-12 are recorded
in `.dependency-cruiser-known-violations.json` and only new ones fail.
`pnpm arch:baseline` regenerates that file — run it only after *fixing* a
known violation; a baseline diff that adds entries is a review red flag.

**Rejected — `eslint-plugin-boundaries`:** server has no lint step at all, and
`dependency-cruiser` is already a dependency (repo-intel uses it).
**Rejected — TypeScript project references per ring:** far too heavy for four
independent packages with no workspaces.
**Rejected — `@fastify/awilix`:** we already have a hand-written container, and
the whole test suite is built on `ContainerOverrides`.
**Rejected — an interface per repository:** repositories are already tested
against real Postgres (`*.it.test.ts`, Testcontainers); a second abstraction
over Drizzle adds indirection without a second implementation.

### Legacy: fix on touch

Existing violations (Drizzle in four `routes.ts`, `run-executor.ts` importing
the schema, `repo-intel` importing concrete adapters, two adapters importing
`repo-intel/constants`, two cross-module imports, services taking the whole
`Container`) stay in the baseline. Fix one when the file is being changed for
another reason; don't open a refactor-only PR across modules.

## Acceptance criteria

- `pnpm arch:check` exits 0 on the current tree.
- A value import of `drizzle-orm` in `pulls/status.ts`, a type-only import of a
  Drizzle table there, a new file in `agents/` importing `reviews/helpers.ts`,
  and `node:fs` in `reviewer-core/src` each fail with a named rule (verified
  2026-10-12).
- `pnpm typecheck` and the unit run are unchanged (no source file was edited).

## Out of scope

- Fixing the 34 baselined violations.
- `container.db` used directly in routes/services without a Drizzle import —
  not statically visible to dependency-cruiser; covered by the skill's review
  checklist instead.
- `client/` (covered by `frontend-ui-architecture`) and `e2e/`.
