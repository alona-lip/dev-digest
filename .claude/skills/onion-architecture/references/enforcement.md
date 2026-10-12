# Enforcement — dependency-cruiser

## Files and commands

| What | Where |
|---|---|
| Rules (live) | `server/.dependency-cruiser.cjs` |
| Rules (canonical copy, keep identical) | `.claude/skills/onion-architecture/assets/dependency-cruiser.cjs` |
| Known violations | `server/.dependency-cruiser-known-violations.json` |
| Check (fails on new violations) | `cd server && pnpm arch:check` |
| Refresh baseline (after *fixing*) | `cd server && pnpm arch:baseline` |
| See everything incl. known | `pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs --no-ignore-known` |

`arch:check` cruises `src` and `../reviewer-core/src`, resolves the
`@devdigest/*` aliases through `server/tsconfig.json`, keeps `import type`
edges (`tsPreCompilationDeps: true`), and uses the `err-long` reporter, which
prints each violated rule's comment — the comment says what to do. Exit code is
the number of error-level violations (#24, #26).

Part of the server check gate together with `pnpm typecheck` and the unit run.
It doesn't need Docker or a DB.

## Rules

Regexes are matched against paths relative to `server/`.

| Rule | From | Forbidden to | Typical fix |
|---|---|---|---|
| `shared-kernel-is-pure` | `src/vendor/shared/**` | anything but itself and `zod` | keep contracts/ports as data + interfaces |
| `domain-is-pure` | `modules/*/{helpers,status,constants}.ts` | value imports of `db`, `adapters`, `platform` (except `errors.ts`), repositories, Drizzle, Fastify, SDKs | pass plain values in; move I/O to the service |
| `domain-knows-no-infra-types` | same | *type* imports of the above, except `db/rows.ts` and `platform/errors.ts` | type mappers with `db/rows.ts` row types |
| `db-only-in-repositories` | `src/modules/**` except repositories | `src/db/**` (except `rows.ts`), `drizzle-orm`, `postgres` | add a repository method |
| `application-knows-no-http` | `src/modules/**` except `routes.ts`, `index.ts` facades, `_shared/context.ts` | Fastify packages, `routes.ts` | return DTOs, throw `AppError` |
| `routes-are-thin` | `**/routes.ts` | `src/db`, `src/adapters`, repositories, Drizzle, SDKs | call the service |
| `sdk-only-in-adapters` | everything except `src/adapters/**`, `container.ts`, `reviewer-core/src/llm/**` | Octokit, simple-git, openai, Anthropic, ripgrep, ast-grep, dependency-cruiser, tiktoken | port + adapter + container wiring |
| `modules-use-ports-not-adapters` | `src/modules/**` | `src/adapters/**` | use the container-provided port |
| `adapters-dont-know-modules` | `src/adapters/**` | `src/modules/**` | move the shared constant/type outward-in (adapter or shared kernel) |
| `no-cross-module-internals` | `src/modules/<a>/**` | `src/modules/<b>/**` except `<b>/index.ts` and `_shared` | container repo, facade, or `_shared` |
| `only-composition-root-wires-modules` | `src/platform/**` except `container.ts` | `src/modules/**` | wire in `container.ts` |
| `reviewer-core-is-pure` | `reviewer-core/src/**` | server code (except shared kernel), DB, Fastify, Octokit, simple-git | pass data in from server |
| `reviewer-core-no-node-io` | `reviewer-core/src/**` | `fs`, `child_process`, `net`, `http(s)`, … | pass data in from server |
| `reviewer-core-sdk-only-in-llm` | `reviewer-core/src/**` except `llm/` | `openai` | keep SDK use inside the provider |
| `reviewer-core-via-public-api` | `server/src/**` | `reviewer-core/src/**` except `index.ts` | export it from `index.ts` |
| `no-circular` | anywhere | runtime import cycles (type-only cycles ignored) | usually two rings merged — split them |
| `not-to-unresolvable` | anywhere | unresolvable imports | typo, missing `npm ci` in reviewer-core, unknown alias |

## When a rule fires

1. Read the rule name and the comment `err-long` printed.
2. Find the ring of the *from* file (SKILL.md §2) and decide where the code
   really belongs (§3).
3. Move the code, not the rule. If the move is out of scope for the current
   task, stop and tell the user rather than baselining it.
4. A real gap in the rules (a legitimate new pattern the rules don't know) →
   change the rule in both config copies, record the reason in
   `server/specs/onion-architecture.md`, bump the skill's minor version.

## Ratcheting the baseline

- Run `pnpm arch:baseline` only after removing a violation. The diff of
  `.dependency-cruiser-known-violations.json` must contain only deletions —
  reviewers should treat an added entry as a blocker.
- Rolling rules out gradually against an existing codebase and failing CI only
  on new violations is the approach lastminute.com describes for their app (#25).

## Verified behaviour (2026-10-12)

Each of these fails `arch:check` with the named rule: a value import of
`drizzle-orm` in `pulls/status.ts` (`domain-is-pure`,
`db-only-in-repositories`); a type-only import of a Drizzle table there
(`domain-knows-no-infra-types`); a new file in `agents/` importing
`reviews/helpers.ts` (`no-cross-module-internals`); `node:fs` in
`reviewer-core/src` (`reviewer-core-no-node-io`).
