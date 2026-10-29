<!-- Generated from routing.json by `node scripts/route.mjs --print-table > routing.md`. Do not edit by hand. -->

# What pr-self-review checks

Every changed file lands in exactly one bucket (first match wins). It is reviewed by the
bucket's **core** skills plus every **extra** whose pattern matches it. Deterministic
checks run when any file in their trigger list changed.

| Bucket | Files | Core skills | Extras | Checks |
|---|---|---|---|---|
| **Frontend**<br>Next.js studio — client/src | `client/src/**/*.{ts,tsx}`<br>except `client/src/vendor/**` | frontend-architecture, react-best-practices, react-testing-library<br>`**/*.test.{ts,tsx}`, `client/src/test/**` → only react-testing-library | next-best-practices → `client/src/app/**`<br>zod → files importing zod<br>typescript-expert (max WARNING) → type-level code (infer, keyof, satisfies, guards, conditional types) | client-typecheck-tests |
| **Backend**<br>Fastify API + Drizzle — server/src | `server/src/**/*.ts`<br>except `server/src/vendor/**`, `server/src/db/migrations/**` | onion-architecture, fastify-best-practices, drizzle-orm-patterns | security → `server/src/modules/*/routes.ts`, `server/src/app.ts`, `server/src/server.ts`, `server/src/platform/**`, `server/src/adapters/**`<br>postgresql-table-design → `server/src/db/schema.ts`, `server/src/db/schema/**`<br>zod → files importing zod<br>typescript-expert (max WARNING) → type-level code (infer, keyof, satisfies, guards, conditional types) | server-typecheck-tests, arch-check |
| **Database**<br>SQL migrations — server/src/db/migrations | `server/src/db/migrations/*.sql` | postgresql-table-design | — | migrations |
| **Engine**<br>Pure review engine — reviewer-core/src (no Fastify, no Drizzle) | `reviewer-core/src/**/*.ts`<br>except `reviewer-core/src/vendor/**` | onion-architecture | security → `reviewer-core/src/llm/**`<br>zod → files importing zod<br>typescript-expert (max WARNING) → type-level code (infer, keyof, satisfies, guards, conditional types) | reviewer-core-typecheck-tests, arch-check |
| **Shared contracts**<br>Wire contracts vendored into each package — */vendor/shared | `{client,server,reviewer-core}/src/vendor/shared/**/*.ts` | zod | — | check-shared |
| **MCP**<br>Local stdio MCP server — mcp-server (thin HTTP client over the API; tool args come from a model) | `mcp-server/{src,test}/**/*.ts`, `mcp-server/scripts/**/*.mjs` | typescript-expert, security<br>`mcp-server/test/**` → only typescript-expert | zod → files importing zod | mcp-server-typecheck-tests |
| **Not covered** | anything not ignored and in no bucket (e2e, tests outside client, configs, scripts) | — | — | listed in the report |

## Deterministic checks

| Check | Runs when changed |
|---|---|
| migrations | `server/src/db/migrations/**` |
| lockfile | `**/pnpm-lock.yaml`, `**/package-lock.json` |
| link-agents | `AGENTS.md`, `CLAUDE.md`, `**/AGENTS.md`, `**/CLAUDE.md` |
| check-shared | `{client,server}/src/vendor/shared/**` |
| arch-check | `server/src/**`, `reviewer-core/src/**`, `server/.dependency-cruiser*` |
| server-typecheck-tests | `server/src/**`, `server/test/**`, `server/package.json`, `server/tsconfig*.json`, `server/vitest*` |
| client-typecheck-tests | `client/src/**`, `client/package.json`, `client/tsconfig*.json`, `client/vitest*` |
| reviewer-core-typecheck-tests | `reviewer-core/src/**`, `reviewer-core/test/**`, `reviewer-core/package.json`, `reviewer-core/tsconfig*.json`, `reviewer-core/vitest*` |
| mcp-server-typecheck-tests | `mcp-server/src/**`, `mcp-server/test/**`, `mcp-server/scripts/**`, `mcp-server/package.json`, `mcp-server/tsconfig*.json`, `mcp-server/vitest*` |

## Ignored

`*.md`, `docs/**`, `specs/**`, `{client,server,reviewer-core,e2e,mcp-server}/**/*.md`, `**/pnpm-lock.yaml`, `**/package-lock.json`, `**/*.lock`, `**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,pdf}`, `server/clones/**`, `**/node_modules/**`, `server/src/db/migrations/meta/**`

## Excluded skills (not review skills)

`mermaid-diagram`, `engineering-insights`, `pr-self-review`, `run-plan`, `workflow-retro`
