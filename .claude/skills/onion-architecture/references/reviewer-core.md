# reviewer-core — the pure engine

`reviewer-core` is the inner ring that the review pipeline revolves around:
diff + context → prompt → LLM → findings → grounding → score. It is consumed by
`server` (raw TS via the `@devdigest/reviewer-core` tsconfig alias) and by the CI
agent-runner, so it must run anywhere with no DB, no GitHub and no disk.

## What lives where

| Path | Ring | Notes |
|---|---|---|
| `src/prompt.ts`, `src/grounding.ts`, `src/review/*`, `src/output/*` | pure core | functions over `@devdigest/shared` contracts |
| `src/llm/openrouter.ts`, `src/llm/structured.ts` | driven adapter | implements the `LLMProvider` port; the only place `openai` may be imported |
| `src/index.ts` | public API | everything consumers may use is re-exported here |

`@devdigest/shared` resolves to `server/src/vendor/shared` (see
`reviewer-core/tsconfig.json`) — the shared kernel, so importing it is fine.

## Rules (all enforced by `pnpm arch:check` in `server/`)

- `reviewer-core-is-pure` — no imports of server code (other than the shared
  kernel), Drizzle, Postgres, Fastify, Octokit or simple-git.
- `reviewer-core-no-node-io` — no `fs`, `child_process`, `net`, `http(s)`,
  `worker_threads` …
- `reviewer-core-sdk-only-in-llm` — the `openai` SDK only under `src/llm/`.
- `reviewer-core-via-public-api` — server imports `@devdigest/reviewer-core`,
  never `../reviewer-core/src/review/run` etc.

## When a change seems to need I/O

The core asks; the shell fetches. If the engine needs file contents, the repo
map, callers of a symbol, past findings or skills:
1. Add an optional input to the function / prompt slot (`skills`, `memory`,
   `specs`, `callers` already exist for this — don't delete them).
2. Load the data in server (a service via a port or repository).
3. Pass plain data in.

This keeps the engine deterministic and testable with a stub `LLMProvider`.

## Decisions that are part of the engine's contract

- The final score is computed from the findings that survived the grounding
  gate (`scoreFromFindings`); the model's self-reported score is ignored.
- `INJECTION_GUARD` is deliberately not a keyword filter — don't "simplify" it.
- `Review` / `Finding` / `Verdict` contracts change only in sync with server and
  client.

## Commands

`npm run typecheck` · `npm test` (npm, not pnpm, in this package). The
architecture rules for it run from `server/` (`pnpm arch:check`), which cruises
`../reviewer-core/src` too.
