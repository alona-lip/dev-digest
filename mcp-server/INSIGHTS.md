# mcp-server — INSIGHTS

Non-obvious findings from real sessions. Append-only: correct an entry with a new dated one.

## What Works

## What Doesn't Work

- 2026-10-24 — `pnpm -s start </dev/null | wc -c` "proves" a clean stdout falsely: pnpm 12 has no `-s`/`--silent`, so it exits with `unexpected argument '-s'` on stderr and stdout is trivially empty. NEVER use `pnpm -s` for the stdout check; run the server binary directly — `node_modules/.bin/tsx src/index.ts </dev/null 2>/dev/null | wc -c` → `0` (plain `pnpm start` is also clean: pnpm 12 prints its `$ tsx …` banner to stderr). (`mcp-server/README.md`, Verify)

## Codebase Patterns

## Tool & Library Notes

- 2026-10-24 — `@modelcontextprotocol/sdk` 1.32 validates tool args against the Zod shape itself and answers a bad call (e.g. `pr: 0`) with plain text `MCP error -32602: Input validation error: … at pr` — not our `{error}` JSON, and the handler never runs. Anything that parses tool output (harness, tests) must fall back to raw text instead of `JSON.parse` blindly. (`mcp-server/scripts/call.mjs`, `pretty()`)
- 2026-10-24 — The project `.mcp.json` server showed up `✔ connected` in `/mcp` with no approval prompt although `~/.claude.json` had `enabledMcpjsonServers: []` (the folder had been trusted before `.mcp.json` existed). When "devdigest is missing", first run `claude mcp list` from the repo root (health check without a session) and make sure `/mcp` was actually submitted with Enter — the autocomplete list alone looks like an empty result. (low confidence on the approval rule)

## Recurring Errors & Fixes

- 2026-10-25 — `test/fixtures.ts` `fakeClient` spells out EVERY `DevDigestClient` method, so adding a
  method to `src/http/client.ts` breaks `pnpm typecheck` across all tests until the fixture gets it
  too. ALWAYS add the new method to `fakeClient` as `unexpected('<name>')` in the same change, and
  override it per test. (`mcp-server/test/fixtures.ts`, `getBlastRadius`)

## Session Notes

### 2026-10-25

- Module created (Lab 4): 5 tools over the API, spec `specs/mcp-server.md` (with "As built"), 27 vitest tests on `core/`. Claude Code scenario passed `list_agents → run_agent_on_pr` (2 findings, so `get_findings` was not needed) and the answer matched the API row for run `502f3625`. Token audit with GitHub MCP v2.0.3 → `docs/token-audit.md`.

## Open Questions
