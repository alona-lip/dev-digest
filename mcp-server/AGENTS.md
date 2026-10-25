# mcp-server — AGENTS.md

## Stack

Local stdio MCP server: `@modelcontextprotocol/sdk` v1 (`McpServer.registerTool`), Zod 3 tool
schemas, `tsx` at runtime (no build step). A thin HTTP client over the DevDigest API
(`:3001`) — no business logic, no DB, no secrets. Spec — [specs/mcp-server.md](./specs/mcp-server.md).

## Commands

`pnpm start` (stdio; needs the API up — `./scripts/dev.sh`, separately) · `pnpm inspect` (MCP Inspector)
· `pnpm call <tool> '<json>'` (one call, no UI) · `pnpm typecheck` · `pnpm test`.
Not started by `./scripts/dev.sh`; Claude Code starts it from the root `.mcp.json`.

## Map

- `src/index.ts` — composition root: builds the client, registers the 5 tools, connects stdio. The only place that wires deps.
- `src/tools/*` — one file per tool: Zod input shape, description, annotations, MCP envelope. Thin.
- `src/core/*` — id resolution (`repo`/`pr`/`agent` → UUID), findings shaping, run-and-wait. Pure functions over `DevDigestClient`; no MCP imports.
- `src/http/client.ts` — the only `fetch`. Its method list is the permission boundary.
- `src/format.ts` — `toolOk`/`toolError`, compact projections, `apiFailure` (HTTP status → next step).

## Non-default conventions

- Tool names have no prefix (`list_agents`) — Claude Code already adds `mcp__devdigest__`.
- Business failures return `toolError(...)` (`isError: true`) with a next step; they never throw out of a handler. Empty lists are results, not errors.
- Read tools set `readOnlyHint: true`; only `run_agent_on_pr` writes and only it has `openWorldHint: true`.
- Wire field names stay `snake_case` in tool output (`run_id`, `start_line` → `line`).

## Gotchas

- **Never `console.log` under `src/`** — stdout is the JSON-RPC channel; one stray line breaks the protocol. Log via `src/log.ts` (stderr).
- `@devdigest/shared` resolves to `../server/src/vendor/shared` via tsconfig `paths`, **type-only**. A value import would make this package depend on server at runtime — use `import type`. `pnpm typecheck` needs `server/node_modules` (zod for those files).
- `POST /pulls/:id/review` is rate-limited to 10/min — trigger once per tool call, never in a retry loop.
- Claude Code aborts a tool call after `MCP_TOOL_TIMEOUT` (150 s, root `.claude/settings.json`); `config.runTimeoutMs` (120 s) must stay below it.

## Do-not-touch

- **`pnpm-lock.yaml`** — never hand-edit or delete; changes only via pnpm in this folder.
- Don't add write tools (delete/update/settings) or methods to `http/client.ts` beyond what a tool needs — that client is the capability boundary.
- Don't add `list_prs` / `list_repos` — `gh` and GitHub MCP already cover them.

## Read when

- Changing a tool's contract or adding one → [specs/mcp-server.md](./specs/mcp-server.md).
- Running / connecting it → [README.md](./README.md).
- Past decisions and gotchas → [INSIGHTS.md](./INSIGHTS.md).
