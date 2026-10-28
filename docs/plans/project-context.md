# Implementation Plan: Project Context — manually attaching specs to agents and skills
Spec: `specs/project-context.md` (SPEC-01)

## Overview
The server finds a repository's `.md` documents in its clone (default branch) using a glob from
server config. A read-only Project Context page lists them, and agents and skills attach them by hand
in a chosen order. At run start the server reads the attached files, dedupes them and applies the
12,000-token budget. They go into the existing `## Project context` prompt slot as untrusted blocks,
followed by a trusted rule, with no extra LLM call. The run trace records `specs_read` and a
per-document `spec_blocks` list, and the trace drawer renders them.

## Execution mode
**multi-agent (parallel), `max-parallel:2`.** The user chose this on 2026-10-28. The feature spans
reviewer-core, server (DB, adapter, new module, run executor) and client (page, two editor tabs, trace
drawer). Once the contracts land (T1), these areas share no files, so the DAG below runs two lanes at a
time with non-overlapping `Owned paths`.

```mermaid
flowchart LR
  T1[T1 contracts] --> T4[T4 docs reader adapter]
  T1 --> T5[T5 server helpers]
  T1 --> T6[T6 client hooks + md preview]
  T1 --> T7[T7 trace drawer]
  T2[T2 reviewer-core slot] --> T10
  T3[T3 DB schema + migration] --> T8[T8 attachment repo]
  T4 --> T9[T9 service + routes]
  T5 --> T9
  T8 --> T9
  T9 --> T10[T10 run executor]
  T6 --> T11[T11 shared picker]
  T11 --> T12[T12 page + nav]
  T11 --> T13[T13 agent tab]
  T11 --> T14[T14 skill tab]
  T2 --> T15[T15 core AC tests]
  T10 --> T16[T16 server AC tests]
  T10 --> T17[T17 manual lab AC-54]
  T13 --> T17
```

## Open questions & recommendations
- Q: Execution mode → answer: multi-agent, `max-parallel:2` (user, 2026-10-28).
- Q: The sidebar entry needs an edit to do-not-touch `client/src/vendor/ui/nav.ts` → answer: approved
  as a **sanctioned exception**. Add one item to the WORKSPACE group (`key:"context"`, href
  `/repos/:repoId/context`, no gKey). Precedent: commit `75a1f6c` added the Conventions item the same
  way. No other `vendor/ui` file may be touched.
- Q: Glob matching → answer: `pnpm add picomatch` + `pnpm add -D @types/picomatch` in `server/`, used
  **only** inside the new fs adapter, with `{ dot: true }`.
- Q: Shape of the reviewer-core `specs` slot → answer: `specs?: (string | PromptSpec)[]` with
  `PromptSpec = { path: string; text: string }`. Plain strings keep the `spec-N` label, so
  `reviewer-core/test/prompt-structured.test.ts` and `server/test/prompt-callers.test.ts` stay
  unmodified.
- Q: Spec defects (AC-49 tokens for a file grown past 1 MB; AC-33/AC-31 truncated list vs. full set)
  → answer: fixed in the spec by `spec-creator` (still approved, 54 ACs). The plan follows the new
  text: validation and "missing" use the **full set of matches**, and a file grown past 1 MB at run
  time is `over_budget`, `tokens: null`, with the log reason "> 1 MB".
- Q: AC-35 bundles several behaviours → answer: plan-level decision. AC-35 is met by one shared
  picker (`client/src/components/context-docs-picker/`) whose RTL tests run for both the agent and the
  skill variant (`describe.each`), plus the server AC-33 test run against both endpoints.
- Rec: a token cache keyed by (path, size, mtime) for the list (NFR p95 ≤ 2 s) → accepted.
- Rec: a shared 12,000 budget constant, with the greedy-budget helper implemented on both sides → accepted.
- Rec: reviewer-core keeps reporting `assembly.specs`; the executor overrides it to `null` and adds
  `spec_blocks`, mirroring `skill_blocks` → accepted.
- Rec: an e2e flow → deferred. No AC requires one; the RTL + integration tests cover the ACs.
- Noted, not reopened: AC-36 shows `## Project specifications` while the real prompt heading is
  `## Project context`. The spec makes this display-only (Non-goals).

## Decisions
| Decision | Choice | Rejected alternative (reason) |
|---|---|---|
| Storage of attachments | Two tables, `agent_context_docs` and `skill_context_docs` (workspace_id, owner FK, repo_id FK, path, position), all FKs `ON DELETE CASCADE`, unique (owner, repo, path) | One polymorphic table with nullable `agent_id`/`skill_id` + CHECK (more complex uniques and queries for no gain); `owner_kind + owner_id` without FK (cannot cascade, breaks AC-38); a JSON column on `agents`/`skills` (would tempt a version bump, AC-39, and has no repo FK cascade) |
| Server module | New `server/src/modules/project-context/` (routes, service, helpers, constants, `repository/attachment.repo.ts`, index) | Extending `repo-intel` (it already does clone I/O, but would bloat an indexer facade with a CRUD feature); naming it `context` (clashes with `_shared/context.ts`, the request context) |
| Executor → module edge | Lazy `container.projectContext` getter built by `createProjectContextService(container)` (server INSIGHTS 2026-10-23) | `reviews` importing the `project-context/index.ts` facade (works today, but invites a cycle once project-context needs agents/skills data) |
| Clone file I/O | New port `ProjectDocsReader` in `vendor/shared/adapters.ts` + fs adapter `src/adapters/project-docs/fs-reader.ts` + mock + `ContainerOverrides.projectDocs` | Reusing `repoIntel.readRepoFile`/`readClone` (reads with `'utf8'`, so binary decodes silently and AC-4/AC-44 cannot tell it apart; no size cap; no glob/exclusion check); `node:fs` directly in the service (onion §1: the disk is external, no test double) |
| UTF-8 detection | `new TextDecoder('utf-8', { fatal: true })` on the bytes | Heuristics such as NUL-byte sniffing (miss invalid sequences; AC-4 says "not valid UTF-8") |
| Glob matcher | `picomatch` with `{ dot: true }`, adapter-only | `path.matchesGlob` (experimental on Node 22, no `dot` option); a hand-written glob→regex (brace and `**` edge cases need their own suite) |
| Exclusions | Directory walk never descends into `node_modules/` or `.git/` at any depth, and does not follow symlinked directories; symlinked files are realpath-checked to stay inside the clone | Glob negation patterns (a custom glob in config could drop them; AC-2 says "regardless of the glob") |
| 1 MB | `CONTEXT_MAX_FILE_BYTES = 1_048_576` (1 MiB), checked on `stat.size` before reading | 1,000,000 bytes (either passes the 1.1 MB fixture; MiB matches the "kb" display used elsewhere) |
| Doc type for a path with no bucket segment (possible only with a custom glob) | Fallback `docs` | Dropping the file (it surprises a user who widened the glob); a 4th enum value (a contract change beyond the spec) |
| Contracts | New file `server/src/vendor/shared/contracts/project-context.ts`; additive `.nullish()` `spec_blocks` on `PromptAssembly` in `trace.ts`; new port in `adapters.ts` | Extending/replacing `SpecFile`/`IndexStatus` (they stay untouched and unused, so there is no edit to an existing contract shape) |
| Client scaffolding hooks | Remove `useContextFiles` / `useReindexContext` and the `context` key from `client/src/lib/hooks/core.ts` (no consumers; `/context/reindex` is a Non-goal); new domain file `lib/hooks/project-context.ts` | Keeping them (wrong type `SpecFile[]`, dead endpoint) |
| "Missing" and validation set (AC-31, AC-33) | The server computes both against the **full** match set; `GET …/context` attachments return per-path `missing` and token metadata | The client deciding "missing" against the ≤ 500 list (would mark document #501 missing; contradicts AC-31) |
| Path-validation error status (AC-33: 422, user decision 2026-10-28) | `new ValidationError('Some paths are not attachable', { rejected: string[] })` (422, `platform/errors.ts`), the same status as every other validation error in the API | A custom `AppError(…, 400)`: the spec originally said 400, but it would be the only 400 validation error in the server; the user changed AC-33 to 422 for consistency |
| Content of a too-large doc (AC-8) | `new AppError('too_large', …, 413)` with the reason | 404 (AC-8 wants "an error with the reason", distinct from not-found) |
| `specs` slot type | `(string \| PromptSpec)[]` | Breaking change to `PromptSpec[]` (edits 2 existing tests, against AC-42's "pass unmodified") |
| Label neutralisation | `specLabel(path)`: every character outside `[A-Za-z0-9._/@+-]` → `_`, then `wrapUntrusted(label, text)`, whose semantics are unchanged | Escaping `"` only (misses `<`, newline and `>`); HTML entity encoding (the model then reads `&quot;`, which is no clearer and longer) |
| Trusted rule | New `PROJECT_CONTEXT_RULE` constant in `reviewer-core/src/prompt.ts`, appended after the last block as `## Project context\n<blocks>\n\n<rule>` | Putting the rule inside a wrapped block (dead text by the guard's own definition, reviewer-core INSIGHTS 2026-10-23) |
| `assembly.specs` for new traces | reviewer-core keeps returning the joined blocks; the executor writes `specs: null` + `spec_blocks` | Changing reviewer-core to return `null` (alters existing assembly semantics for string specs) |
| `spec_blocks[].text` | The raw document text, exactly what `tokens` was counted on (pre-wrap) | The wrapped/escaped block (the wrapper is not counted per NFR; `user` already holds the exact message) |
| Token cache for the list | In-memory `Map` in the service keyed by `${repoId}:${path}` → `{ size, mtimeMs, tokens }`; a refresh re-stats and re-tokenizes only what changed | No cache (pure-JS tiktoken over 5 MB risks the 2 s p95); persisting counts in Postgres (a new table and staleness on resync) |
| Budget logic | `PROJECT_CONTEXT_TOKEN_BUDGET = 12000` in the shared contract; a greedy `applyBudget` helper on the server (`project-context/helpers.ts`) and on the client (`context-docs-picker/helpers.ts`), each unit-tested with the 7k/7k/2k case | One shared function in `vendor/shared` (the shared kernel holds contracts and ports, not logic); computing the warning on the server only (the optimistic toggle would wait a round trip) |
| Run-time token count | Fresh read + `container.tokenizer.count(text)` per run; no cache | Reusing the list cache (AC-41 demands the state as of the read at run start) |
| Picker UI | One shared `client/src/components/context-docs-picker/` used by the agent tab (in `app/`) and the skill tab (in `components/skill-editor`) | Two copies (AC-35 parity by duplication drifts); a route-local component (a shared skill-editor cannot import from `app/`) |
| Reorder UX | Native HTML5 drag + ↑/↓ buttons, mirroring the agent `SkillsTab` | Adding a DnD library (a new dependency; the Skills tab already shows the pattern) |
| Markdown preview | Shared `client/src/components/markdown-preview/` over `react-markdown` with `skipHtml`, no `rehype-raw` (2 consumers: page + picker) | `dangerouslySetInnerHTML` / `rehype-raw` (NFR: no raw HTML/scripts) |
| Search roots | `CONTEXT_ROOTS` env (comma-separated, default `.`), `CONTEXT_GLOB` env (default `**/{specs,docs,insights}/**/*.md`) in `AppConfig` | A per-repo UI setting (Non-goal) |

## Affected modules & contracts
- **reviewer-core** — the `specs` slot accepts `PromptSpec`; path-label neutralisation; `PROJECT_CONTEXT_RULE`; exports.
- **server** — new migration + 2 tables; new port, adapter and mock; config (`CONTEXT_GLOB`, `CONTEXT_ROOTS`);
  new `project-context` module (8 routes); `run-executor.ts` integration; `picomatch` dependency.
- **client** — new hooks domain; shared `markdown-preview` and `context-docs-picker`; the
  `/repos/[repoId]/context` page; agent and skill Context tabs; trace drawer section; the nav item (sanctioned
  `vendor/ui` exception); i18n in `context`, `agents`, `skills`, `runs`.
- **mcp-server, e2e** — no change (Non-goals).
- **Contracts:**
  - NEW `server/src/vendor/shared/contracts/project-context.ts`:
    - `ContextDocType = z.enum(['specs','docs','insights'])`
    - `ContextDoc = { path, type, size_bytes, tokens: int|null, too_large }`
    - `ContextDocList = { status: 'ok'|'not_cloned', glob, truncated, read_at, docs: ContextDoc[] }`
    - `ContextDocContent = { path, type, content, tokens }`
    - `ContextAttachmentDoc = { path, type: ContextDocType|null, tokens: int|null, too_large, missing }`
    - `ContextAttachments = { repo_id, paths: string[], docs: ContextAttachmentDoc[] /* same order as paths */, inherited: (ContextAttachmentDoc & { via_skill: { skill_id, name } })[] /* agents only, [] for skills */ }`
    - `ContextAttachmentsInput = { repo_id: uuid, paths: string[] }`
    - `ContextUsage = { repo_id, by_path: Record<string, { agents: int, skills: int }> }`
    - `SpecBlock = { path, type, origin: {kind:'agent'} | {kind:'skill', skill_id, name}, status: 'attached'|'missing'|'over_budget', tokens: int|null, text: string|null }`
    - constants `PROJECT_CONTEXT_TOKEN_BUDGET = 12000`, `CONTEXT_LIST_LIMIT = 500`, `CONTEXT_MAX_FILE_BYTES = 1_048_576`
  - **Additive edit to an existing contract (explicit callout):** `contracts/trace.ts` → `PromptAssembly.spec_blocks: z.array(SpecBlock).nullish()`. Old traces parse unchanged.
  - **Additive edit to `vendor/shared/adapters.ts` (explicit callout):** a new port `ProjectDocsReader` (below). Existing ports are untouched.
  - `vendor/shared/index.ts` re-exports the new file. Everything is mirrored with `./scripts/check-shared.sh --sync`.

Port (shape for T1/T4):
```ts
export interface DocsScope { glob: string; roots: string[] }
export interface DocStat { path: string; size_bytes: number; mtime_ms: number }
export type DocRead =
  | { kind: 'ok'; text: string; size_bytes: number }
  | { kind: 'not_found' }            // missing, excluded, no glob match, or realpath outside the clone
  | { kind: 'too_large'; size_bytes: number }
  | { kind: 'not_text' };            // not valid UTF-8
export interface ProjectDocsReader {
  /** Full match set, sorted by path (byte order), stat only — no content read. */
  scan(clonePath: string, scope: DocsScope): Promise<DocStat[]>;
  read(clonePath: string, path: string, scope: DocsScope & { maxBytes: number }): Promise<DocRead>;
}
```

Routes (all workspace-scoped via `getContext`; an agent, skill or repo of another workspace → 404):

| Method | Path | Returns | ACs |
|---|---|---|---|
| GET | `/repos/:repoId/context` | `ContextDocList` (first 500, `truncated`) | AC-1–6, AC-13, AC-20 |
| GET | `/repos/:repoId/context/file?path=` | `ContextDocContent` · 404 · 413 `too_large` | AC-7, AC-8 |
| GET | `/repos/:repoId/context/usage` | `ContextUsage` | AC-12 |
| GET / PUT | `/agents/:agentId/context?repo_id=` / body `ContextAttachmentsInput` | `ContextAttachments` | AC-22, AC-26, AC-31, AC-33 |
| GET / PUT | `/skills/:skillId/context?repo_id=` / body `ContextAttachmentsInput` | `ContextAttachments` (`inherited: []`) | AC-35, AC-33 |

## Architecture changes
- `server/src/db/schema/context.ts` (ring 3a): `agentContextDocs`, `skillContextDocs`. Row types are added to
  `server/src/db/rows.ts`. NEW migration `server/src/db/migrations/0016_<generated>.sql` + `meta/*`
  via `pnpm db:generate`. No existing migration is edited.
- `server/src/adapters/project-docs/fs-reader.ts` (ring 3a): the only importer of `picomatch` and `node:fs` for this
  feature. Wired in `server/src/platform/container.ts` (composition root) as `container.projectDocs`, with
  `ContainerOverrides.projectDocs`. `MockProjectDocsReader` goes in `server/src/adapters/mocks.ts`.
- `server/src/platform/config.ts`: `contextGlob`, `contextRoots` added to `AppConfig` (env `CONTEXT_GLOB`, `CONTEXT_ROOTS`).
- `server/src/modules/project-context/helpers.ts`, `constants.ts` (ring 1, pure): `docTypeOf`,
  `toListPage` (sort + 500 + `truncated`), `buildEffectiveSet`, `applyBudget`, `countUsage`, `toAttachmentDocs`.
- `server/src/modules/project-context/repository/attachment.repo.ts` (ring 3a): Drizzle functions taking `db` first.
- `server/src/modules/project-context/service.ts` (ring 2): `ProjectContextService` with **narrow constructor
  deps** (reposRepo-like `getById`, `projectDocs`, `tokenizer`, `activeSkills(agentId)`, `listAgentIds`,
  config scope, `db`). Factory: `createProjectContextService(container)`.
- `server/src/modules/project-context/routes.ts` (ring 3b): thin; Zod params/query/body.
- `server/src/modules/project-context/index.ts` (facade): types + factory only. Registered in `server/src/modules/index.ts`.
- `server/src/platform/container.ts`: lazy getter `projectContext` (type `ProjectContextPort`).
- `server/src/modules/reviews/run-executor.ts` (ring 2): calls `container.projectContext.forRun(...)` after the
  skill scan; passes `specs`; writes `specs_read`/`spec_blocks`; hoists the result above the `try` so the
  catch path (`traceFromBuffer`) also writes them (AC-48).
- `reviewer-core/src/prompt.ts`, `src/review/run.ts`, `src/index.ts`: pure; no I/O.
- Client: `src/lib/hooks/project-context.ts` (data layer); `src/components/markdown-preview/`,
  `src/components/context-docs-picker/` (shared); `src/app/repos/[repoId]/context/` (thin RSC `page.tsx` →
  `"use client"` `ProjectContextView`); editor tabs are `"use client"` leaves.

## Phased tasks

### Phase 1 — Contracts and engine (T1 ∥ T2)

- [x] **T1** Shared contracts + port + sync → scaffolding for AC-1…AC-53 (every server/client task depends on it) → `server/test/contracts.test.ts` (existing, must stay green) + `./scripts/check-shared.sh`
  - **Action:** Create `contracts/project-context.ts` with the schemas and constants listed above
    (`snake_case` fields, `z.infer` types exported). Add `spec_blocks: z.array(SpecBlock).nullish()` to
    `PromptAssembly` in `contracts/trace.ts` (additive only). Add `DocsScope`, `DocStat`, `DocRead`
    and `ProjectDocsReader` to `vendor/shared/adapters.ts`. Re-export from `vendor/shared/index.ts`. Run
    `./scripts/check-shared.sh --sync`, then `./scripts/check-shared.sh`.
  - **Module:** server (+ client vendored copy) · **Type:** backend
  - **Skills to use:** zod, onion-architecture, typescript-expert
  - **Owned paths:** `server/src/vendor/shared/contracts/project-context.ts`, `server/src/vendor/shared/contracts/trace.ts`, `server/src/vendor/shared/adapters.ts`, `server/src/vendor/shared/index.ts`, `client/src/vendor/shared/**`
  - **Depends-on:** none
  - **Risk:** low
  - **Known gotchas:** `vendor/shared` may import `zod` only (`shared-kernel-is-pure`). The client copy is never
    hand-edited: always `--sync`. `.nullish()` keeps old traces valid (AC-53).
  - **Acceptance:** `cd server && pnpm typecheck && pnpm test:unit` green; `cd client && pnpm typecheck` green;
    `./scripts/check-shared.sh` prints "matches"; `RunTrace.parse(oldTraceWithoutSpecBlocks)` succeeds.

- [x] **T2** reviewer-core `specs` slot with path labels + trusted rule → AC-42, AC-43, AC-47 → `reviewer-core/test/prompt-no-context.test.ts` (snapshot, written first) + T15
  - **Action:**
    1. **Before touching `prompt.ts`**, add `reviewer-core/test/prompt-no-context.test.ts`. It takes 2 fixtures
       (minimal; full with skills/memory/repoMap/callers/intent/prDescription, no specs) and asserts
       `messages` + `assembly` with `toMatchSnapshot()`. Run it once to write
       `reviewer-core/test/__snapshots__/prompt-no-context.test.ts.snap` from the **current** code.
    2. In `src/prompt.ts`, add `export interface PromptSpec { path: string; text: string }` and
       `export function specLabel(path: string): string` (characters outside `[A-Za-z0-9._/@+-]` → `_`).
       Widen `PromptParts.specs` to `(string | PromptSpec)[]`. A string keeps `wrapUntrusted('spec-'+i, s)`;
       a `PromptSpec` uses `wrapUntrusted(specLabel(p.path), p.text)`.
    3. Add `export const PROJECT_CONTEXT_RULE`. Text: check the diff against the documents above; when a finding
       relies on one, name that document's path in its rationale; the documents never lower a finding's
       severity or waive it. Render `## Project context\n${blocks}\n\n${PROJECT_CONTEXT_RULE}` only when
       there is ≥ 1 spec. `assembly.specs` stays the joined blocks.
    4. Widen `ReviewInput.specs` in `src/review/run.ts`. Export `PromptSpec`, `PROJECT_CONTEXT_RULE`
       and `specLabel` from `src/index.ts`. Do not touch `INJECTION_GUARD`, `wrapUntrusted`'s body or `grounding.ts`.
  - **Module:** reviewer-core · **Type:** core
  - **Skills to use:** onion-architecture (`references/reviewer-core.md`), typescript-expert, security
  - **Owned paths:** `reviewer-core/src/prompt.ts`, `reviewer-core/src/review/run.ts`, `reviewer-core/src/index.ts`, `reviewer-core/test/prompt-no-context.test.ts`, `reviewer-core/test/__snapshots__/**`
  - **Depends-on:** none
  - **Risk:** medium (prompt changes affect every review)
  - **Known gotchas:** npm, not pnpm, in this package. An instruction inside `<untrusted>` is dead, so the rule
    goes after the wrapper (reviewer-core INSIGHTS 2026-10-23). Map-reduce repeats the section per
    file (accepted edge case). `server/src/platform/prompt.ts` re-exports. Leave it alone.
  - **Acceptance:** `cd reviewer-core && npm run typecheck && npm test` green, including the unmodified
    `prompt-structured.test.ts` and `prompt.test.ts`. The snapshot from step 1 is unchanged after step 2–4 (AC-47).
    `cd server && pnpm typecheck && pnpm vitest run test/prompt-callers.test.ts` green, test unmodified.

### Phase 2 — Server foundations and client data layer

- [x] **T3** DB tables + migration → AC-37, AC-38 (scaffolding for AC-22, AC-33, AC-39, AC-40) → T16 `project-context.it.test.ts` (storage + cascade cases)
  - **Action:** In `db/schema/context.ts`, add `agentContextDocs` (`agent_context_docs`) and
    `skillContextDocs` (`skill_context_docs`). Columns: `id uuid pk defaultRandom`, `workspace_id` → workspaces
    cascade, `agent_id`/`skill_id` → agents/skills cascade, `repo_id` → repos cascade, `path text not null`,
    `position integer not null`, `created_at` (`now()` from `_shared`). Constraints: `uniqueIndex` on (owner, repo_id, path),
    `index` on (repo_id), and an index on owner (FK index). **No content column** (AC-37). Export the tables via
    `db/schema.ts` (check whether `export * from './schema/context'` already covers them). Add `AgentContextDocRow` /
    `SkillContextDocRow` to `db/rows.ts`. Generate the migration with `pnpm db:generate`.
  - **Module:** server · **Type:** backend
  - **Skills to use:** drizzle-orm-patterns, postgresql-table-design, onion-architecture
  - **Owned paths:** `server/src/db/schema/context.ts`, `server/src/db/schema.ts`, `server/src/db/rows.ts`, `server/src/db/migrations/0016_*.sql`, `server/src/db/migrations/meta/**` (new files + the journal append that `db:generate` writes)
  - **Depends-on:** none
  - **Risk:** low
  - **Known gotchas:** pnpm is not on the bash PATH: prefix `PATH="$HOME/Library/pnpm/bin:$PATH"`. Never edit
    existing `.sql`/journal entries by hand. `db:generate` goes interactive only on add+drop in one table; this is add-only
    (server INSIGHTS 2026-10-19). Migrations are not applied on boot: `pnpm db:migrate` locally.
  - **Acceptance:** `pnpm db:generate` produces exactly one new `0016_*.sql` with two `CREATE TABLE` statements + FKs `ON DELETE cascade`;
    `git diff --stat server/src/db/migrations` shows only new files plus the journal append; `pnpm typecheck` green.

- [x] **T4** `ProjectDocsReader` fs adapter + config + container wiring + mock → AC-1, AC-2, AC-4 (decode), AC-7, AC-8, AC-41, AC-44 (read side) → `server/test/project-docs-reader.test.ts` (T16; temp-dir fixtures, no Docker)
  - **Action:**
    - `pnpm add picomatch` and `pnpm add -D @types/picomatch` in `server/`.
    - Implement `src/adapters/project-docs/fs-reader.ts`, `FsProjectDocsReader implements ProjectDocsReader`.
    - `scan`: `realpath(clonePath)`, then for each root (resolved inside the clone; a root escaping it is ignored), a recursive
      `readdir({ withFileTypes })`.
      - Skip any directory named `node_modules` or `.git` at any depth. Skip symlinked directories.
      - Keep files ending `.md` whose repo-relative POSIX path matches `picomatch(glob, { dot: true })`.
      - `stat` each kept file. Symlinked files: keep only if `realpath` stays inside the clone root.
      - Return the list sorted by path.
    - `read`: normalise the path, then reject absolute paths, `..` segments, an excluded segment or a glob miss → `not_found`.
      `realpath` must start with `root + sep`, else `not_found`. `size > maxBytes` → `too_large`. Then read the bytes and decode with
      `TextDecoder('utf-8', { fatal: true })`; a throw → `not_text`. ENOENT → `not_found`.
    - Add `contextGlob` (default `**/{specs,docs,insights}/**/*.md`) and `contextRoots` (default `['.']`, comma-split) to
      `AppConfig`/`EnvSchema`, plus `server/.env.example` lines.
    - Container: `get projectDocs()` with an override. `ContainerOverrides.projectDocs`.
    - `MockProjectDocsReader` in `adapters/mocks.ts`, backed by an in-memory `Record<path, string | Uint8Array>`.
  - **Module:** server · **Type:** backend
  - **Skills to use:** onion-architecture (`references/di-and-adapters.md`), security, typescript-expert
  - **Owned paths:** `server/src/adapters/project-docs/**`, `server/src/adapters/mocks.ts`, `server/src/adapters/index.ts` (only if adapters are re-exported there), `server/src/platform/config.ts`, `server/src/platform/container.ts`, `server/.env.example`, `server/package.json`, `server/pnpm-lock.yaml` (by-product of `pnpm add` only)
  - **Depends-on:** T1
  - **Risk:** medium (security boundary)
  - **Known gotchas:** `container.git.readFile` has no traversal guard; never use it here (server INSIGHTS 2026-10-19).
    pnpm comes from `~/Library/pnpm/bin` (the lockfile was written by pnpm 12.4.1; if a version mismatch shows up, use
    `npx -y pnpm@12.4.1 add …` and restore any reformatted `engines` line, per server INSIGHTS 2026-10-16). Do not hand-edit the lockfile.
    Check that `specs/x.md` matches the default glob (`**/` matches zero directories). macOS `grep` treats some TS as binary: use `grep -a`.
  - **Acceptance:** `pnpm typecheck && pnpm test:unit && pnpm arch:check` green. `picomatch` is imported only under `src/adapters/`
    (`grep -a -rn "picomatch" server/src` shows only the adapter); the known-violations baseline does not grow.

- [x] **T5** Pure server helpers → AC-3, AC-5, AC-12 (count rule), AC-40, AC-45 → `server/test/project-context-helpers.test.ts` (T16)
  - **Action:** `src/modules/project-context/constants.ts` (re-export the limits from the contract;
    `EXCLUDED_DIRS`, `DOC_BUCKETS = ['specs','docs','insights']`). `helpers.ts`:
    - `docTypeOf(path)`: the deepest **directory** segment in `DOC_BUCKETS`, else `'docs'`.
    - `toListPage(stats, limit)`: sorted by path, `{ items: first limit, truncated }`.
    - `buildEffectiveSet(agentPaths, skills: { skill_id, name, paths }[])`: agent first, then skills in the given
      order; dedupe by **full path**, first occurrence wins; each item carries its `origin`.
    - `applyBudget(items: { path, tokens: number | null, over1mb?: boolean }[], budget)`: greedy. A null-token or >1 MB item is
      `over_budget` without consuming budget; otherwise add it if `sum + tokens ≤ budget`, else `over_budget` and continue.
    - `countUsage(agentAttachments, skillAttachments, activeSkillIdsByAgent)` → `by_path` counts (an agent counts if a path
      is in its own list OR in an active skill's list; a skill counts if it attached the path directly).
    - `toAttachmentDocs(paths, fullSetByPath, tokensByPath)` → `ContextAttachmentDoc[]` with `missing`.
  - **Module:** server · **Type:** backend
  - **Skills to use:** onion-architecture, typescript-expert
  - **Owned paths:** `server/src/modules/project-context/helpers.ts`, `server/src/modules/project-context/constants.ts`
  - **Depends-on:** T1
  - **Risk:** low
  - **Known gotchas:** ring 1 may import only contracts and `platform/errors.ts` (`domain-is-pure`).
  - **Acceptance:** `pnpm typecheck && pnpm arch:check` green. A quick local check: `applyBudget` on 7000/7000/2000 with budget 12000
    → attached/over_budget/attached; `docTypeOf('e2e/docs/specs/x.md') === 'specs'`.

- [x] **T6** Client data hooks + shared markdown preview → scaffolding for AC-9–AC-36 (AC-11, AC-29 render) → `client/src/components/markdown-preview/MarkdownPreview.test.tsx`
  - **Action:** New `src/lib/hooks/project-context.ts` with private query keys:
    - `useContextDocs(repoId)`: GET list.
    - `useContextDoc(repoId, path)`: GET file, `enabled` only when a path is set.
    - `useContextUsage(repoId)`.
    - `useAttachments(kind: 'agent'|'skill', ownerId, repoId)`.
    - `useSaveAttachments(kind, ownerId, repoId)`: PUT with **optimistic** `onMutate` (`setQueryData` of the whole ordered list),
      `onError` rollback to the snapshot, `onSettled` invalidate attachments + usage.

    Add `export * from "./project-context"` to `hooks/index.ts`. Remove `useContextFiles`, `useReindexContext`, the `context` key and
    the `SpecFile`/`IndexStatus` imports from `hooks/core.ts`. Create `src/components/markdown-preview/MarkdownPreview.tsx` (+ `index.ts`,
    test) over `react-markdown` with `skipHtml`, no `rehype-raw`.
  - **Module:** client · **Type:** ui
  - **Skills to use:** frontend-architecture, react-best-practices, react-testing-library, next-best-practices, security
  - **Owned paths:** `client/src/lib/hooks/project-context.ts`, `client/src/lib/hooks/index.ts`, `client/src/lib/hooks/core.ts`, `client/src/components/markdown-preview/**`
  - **Depends-on:** T1
  - **Risk:** low
  - **Known gotchas:** only `src/lib/api.ts` calls `fetch`. `NEXT_PUBLIC_API_BASE` mismatch fails silently. Wire fields stay `snake_case`.
    `"use client"` at the top of the hooks file, as in `core.ts`.
  - **Acceptance:** `cd client && pnpm typecheck && pnpm lint && pnpm test` green. The markdown test renders `# Title` as a heading and
    renders `<script>`/`<img onerror>` input as text, not as elements.

- [x] **T7** Trace drawer: Project context section + Specs read statuses → AC-50, AC-51, AC-52, AC-53 → `RunTraceDrawer.test.tsx` (extended)
  - **Action:** In `TraceBody.tsx`:
    - When `prompt_assembly.spec_blocks` has ≥ 1 entry, render a block titled "Project context — attached specs (untrusted)"
      with the summary "N docs · ≈X tokens" (attached only), placed between repo map and callers (prompt order).
    - Render one `PromptBlock` per `attached` entry (expand shows `text` verbatim, copy button, token count via the existing
      `PromptBlock` props).
    - Keep the old `prompt_assembly.specs != null` branch, shown only when `spec_blocks` is absent (AC-53).
    - "Specs read" row: `specs_read` paths, then the skipped `spec_blocks` with a status badge (`missing` / `over_budget`, a text label,
      not colour alone).
    - i18n keys in `messages/en/runs.json` under `trace.prompt.projectContext*` and `trace.config.specStatus.*`.
  - **Module:** client · **Type:** ui
  - **Skills to use:** frontend-architecture, react-best-practices, react-testing-library
  - **Owned paths:** `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/**`, `client/messages/en/runs.json`
  - **Depends-on:** T1
  - **Risk:** low
  - **Known gotchas:** the old-trace fixture must have `specs: "…"` and no `spec_blocks`, and render exactly as before. Do not reorder the existing sections.
  - **Acceptance:** `pnpm test -- RunTraceDrawer` green, with tests named `AC-50`…`AC-53` (new fixture with 3 statuses + an empty doc; old fixture);
    `pnpm typecheck && pnpm lint` green.

### Phase 3 — Server module and run integration

- [x] **T8** Attachment repository → AC-37, AC-38, AC-39 (storage side) → T16 `project-context.it.test.ts`
  - **Action:** `src/modules/project-context/repository/attachment.repo.ts`, functions taking `db: Db` first:
    - `listPaths(db, kind, ownerId, repoId)`: ordered by `position`.
    - `replacePaths(db, kind, workspaceId, ownerId, repoId, paths)`: one transaction, delete then multi-row insert with
      `position = index`. **Never touches** `agents.version`, `agent_versions` or `skill_versions` (AC-39).
    - `listForRepo(db, repoId)` → `{ agent: {agent_id, path}[], skill: {skill_id, path}[] }`.
    - `listForRun(db, agentId, skillIds, repoId)`.
    - `ownerInWorkspace(db, kind, workspaceId, ownerId)`: typed read of `t.agents` / `t.skills`.
    - `agentIdsInWorkspace(db, workspaceId)`.
  - **Module:** server · **Type:** backend
  - **Skills to use:** drizzle-orm-patterns, onion-architecture
  - **Owned paths:** `server/src/modules/project-context/repository/**`
  - **Depends-on:** T3
  - **Risk:** low
  - **Known gotchas:** reads of other modules' tables use the typed builder with the shared `db/schema` objects, never raw
    `sql` table names (server INSIGHTS 2026-10-17). Use `.mapWith(Number)` for counts.
  - **Acceptance:** `pnpm typecheck && pnpm arch:check` green (`db-only-in-repositories` satisfied).

- [x] **T9** Project-context service + routes + wiring → AC-1, AC-4, AC-5, AC-6, AC-7, AC-8, AC-12, AC-13, AC-20 (`read_at`), AC-22 (server), AC-26 (inherited), AC-31 (missing), AC-33, AC-35 (server), AC-39 → T16 `project-context.it.test.ts`
  - **Action:** `service.ts`, `ProjectContextService` (narrow deps; factory `createProjectContextService(container)` picks
    `container.reposRepo.getById`, `container.projectDocs`, `container.tokenizer`,
    `agentId => container.agentsRepo.activeSkillsForRun(agentId)` mapped to `{id,name}`, `container.db`, config scope).
    The sandwich for each operation:
    - `listDocs(ws, repoId)`:
      - No repo → `NotFoundError`. `clonePath == null` → `{status:'not_cloned', docs:[], truncated:false}`.
      - Otherwise `scan` → `toListPage`. For each item: `size > MAX` → `too_large, tokens:null`. Else the cache hit on (size, mtime)
        or `read` → `not_text` → `tokens:null`, `ok` → `tokenizer.count(text)` (empty → 0).
      - `read_at = new Date().toISOString()`. No git fetch, no LLM.
    - `readDoc(ws, repoId, path)` → `ContextDocContent` | `NotFoundError` | `AppError('too_large', …, 413)`.
    - `usage(ws, repoId)` → `countUsage`.
    - `getAttachments(kind, ws, ownerId, repoId)`: owner check, then a full `scan` set for `missing` + tokens. Agents also get `inherited` from the
      active skills' attachments for that repo, deduped against the agent's own paths.
    - `replaceAttachments(kind, ws, ownerId, input)`:
      - Owner + repo check (404 across workspaces).
      - Validate **every** path against the full match set + `read`, rejecting `not_found`/`too_large` (empty and `not_text` are accepted).
      - Any reject → `ValidationError('Some paths are not attachable', { rejected })` (422) and nothing saved. Otherwise `replacePaths` (duplicate paths in the input → 422 too).
    - `forRun({ workspaceId, repo, agentId, skills: {id,name}[], runLog })` → `{ promptSpecs: PromptSpec[], specBlocks: SpecBlock[], specsRead: string[], tokens: number }`:
      1. One DB snapshot via `listForRun`, then `buildEffectiveSet`.
      2. Fresh `read` per item. `not_found`/`not_text`/no clone → `missing` (tokens null); `too_large` → `over_budget` with `tokens: null` and reason "> 1 MB".
      3. `applyBudget` with `PROJECT_CONTEXT_TOKEN_BUDGET`.
      4. Live Log via `runLog.info`: `Project context: N docs attached (+X tokens)`, one `Spec "<path>" (+X tokens)` line per attached document,
         one `Spec "<path>" skipped: missing (<reason>)` / `skipped: over_budget (> 1 MB | would exceed 12000)` line per skip, plus the structured fields
         `{ runId, docs_attached, docs_skipped, context_tokens }`.
      5. An empty effective set → all arrays empty and no Project context log lines (AC-47).

    `routes.ts`: the 8 routes in the table above with Zod `params`/`querystring`/`body` (`withTypeProvider<ZodTypeProvider>()`). The handler does
    `getContext` → one service call → DTO. `index.ts`: export `ProjectContextPort` + `createProjectContextService`.
    Register the plugin in `modules/index.ts`. Add the lazy `get projectContext()` in `platform/container.ts`. Update
    `server/README.md` (API map + `CONTEXT_GLOB`/`CONTEXT_ROOTS` env rows).
  - **Module:** server · **Type:** backend
  - **Skills to use:** onion-architecture, fastify-best-practices, zod, drizzle-orm-patterns, security, typescript-expert
  - **Owned paths:** `server/src/modules/project-context/service.ts`, `server/src/modules/project-context/routes.ts`, `server/src/modules/project-context/index.ts`, `server/src/modules/index.ts`, `server/src/platform/container.ts`, `server/README.md`
  - **Depends-on:** T4, T5, T8
  - **Risk:** high (largest task; security + tenancy)
  - **Known gotchas:**
    - The service declares its deps as **local structural types**. Never `import` from `modules/agents/repository.ts`
      (`no-cross-module-internals`); the factory reads them off the container.
    - Zod failures map to 422 globally (`app.ts`); the path check uses `ValidationError` (422) too, so every validation failure on these routes is 422.
    - Use the scan-filtered `activeSkills` from the executor at run time, not a fresh query (a skill blocked by the injection scan is not "active in this run").
    - `RunLogger.info(msg, data)`: check that `data` reaches the pino logger. If it does not, call `logger.info(fields, msg)` through the run logger's logger.
  - **Acceptance:** `pnpm typecheck && pnpm test:unit && pnpm arch:check` green (baseline not grown). `test/routes-smoke.test.ts` still green.
    A manual `curl` against `pnpm dev` with a cloned repo returns a `ContextDocList`.

- [x] **T10** Run executor integration → AC-24 (prompt order), AC-40, AC-41, AC-44, AC-45, AC-46, AC-47, AC-48, AC-49 → T16 `project-context-run.it.test.ts`
  - **Action:** In `run-executor.ts::runOneAgent`, declare `let projectCtx: RunContext | undefined` **above** the `try`. After the
    skill-scan filter, set `projectCtx = await this.container.projectContext.forRun({ workspaceId, repo, agentId: agent.id,
    skills: activeSkills.map(({ id, name }) => ({ id, name })), runLog })`. Pass `...(projectCtx.promptSpecs.length > 0 ? { specs:
    projectCtx.promptSpecs } : {})` to `reviewPullRequest`. In the success trace, write
    `prompt_assembly: { ...outcome.assembly, skill_blocks, specs: null, spec_blocks: projectCtx.specBlocks }` and
    `specs_read: projectCtx.specsRead`. Extend `traceFromBuffer(…, projectCtx?)` so the failure/cancel path writes `specs_read` and
    `spec_blocks` when context was assembled, and `[]`/`null` otherwise. Pre-work failures (`failAll`) stay `[]`.
  - **Module:** server · **Type:** backend
  - **Skills to use:** onion-architecture, typescript-expert
  - **Owned paths:** `server/src/modules/reviews/run-executor.ts`
  - **Depends-on:** T2, T9
  - **Risk:** medium
  - **Known gotchas:** the `source: 'ci'` path gets nothing (Non-goal); only `runOneAgent` is touched. A DB error in `forRun` fails the run like
    any start-time read (accepted edge case). Do not import `project-context` files; go only through `container.projectContext`.
  - **Acceptance:** `pnpm typecheck && pnpm test:unit && pnpm arch:check` green. The existing `reviews.it.test.ts` and `skills.it.test.ts` stay green
    (`pnpm test:integration`). A run with no attachments has a `user` message byte-identical to before (AC-47).

### Phase 4 — Client feature UI

- [x] **T11** Shared `ContextDocsPicker` (agent + skill variants) → AC-21, AC-22, AC-23, AC-24, AC-25, AC-26, AC-27, AC-28, AC-29, AC-30, AC-31, AC-32, AC-35 → `client/src/components/context-docs-picker/ContextDocsPicker.test.tsx` (`describe.each(['agent','skill'])`) + `helpers.test.ts`
  - **Action:** `src/components/context-docs-picker/` with `ContextDocsPicker.tsx` (props: `kind`, `ownerId`, `repoId | null`),
    `helpers.ts`, `constants.ts`, `styles.ts`, `index.ts` and `_components/` as needed. `helpers.ts` holds
    `mergeRows(listDocs, attachments)`, `togglePath`, `movePath`, `filterRows`, `effectiveSet`, and `applyBudget`, a greedy mirror of the server
    helper using `PROJECT_CONTEXT_TOKEN_BUDGET`. Behaviour:
    - Rows: checkbox (accessible name contains the path), file name, directory, type badge (text label), Preview button.
    - Filter "Filter documents…" (case-insensitive) and the counter "N of M attached".
    - A toggle saves the **whole ordered path list**, keyed by path, so hidden attachments are kept. Save failure → rollback + i18n error.
    - Reorder by drag and ↑/↓ buttons, disabled while the filter is non-empty.
    - Preview opens `MarkdownPreview` in a modal/pane with no save.
    - A `too_large` row has a disabled checkbox + reason. A `missing` path (from `docs[].missing` / `inherited[].missing`) gets a separate
      row with status "missing" and can be unchecked.
    - No repo → hint, no checkboxes.
    - `kind === 'agent'`: locked inherited rows "via <skill>", not removable, with a duplicate of an own path shown once; a footer
      "≈ N tokens" over the effective set (own, then inherited, no duplicates; empty = 0); a budget warning listing the `over_budget` names.

    i18n under `messages/en/context.json` → `picker.*`.
  - **Module:** client · **Type:** ui
  - **Skills to use:** frontend-architecture, react-best-practices, react-testing-library, next-best-practices, typescript-expert
  - **Owned paths:** `client/src/components/context-docs-picker/**`, `client/messages/en/context.json`
  - **Depends-on:** T6
  - **Risk:** medium
  - **Known gotchas:**
    - Mirror `SkillsTab`'s drag/↑↓ pattern (`app/agents/[id]/_components/AgentEditor/_components/SkillsTab/helpers.ts`), but key by path,
      and do not import from that route (lint boundary).
    - The vendored `Toggle` has no `disabled` prop, so use a native checkbox (client INSIGHTS 2026-10-20).
    - `@devdigest/ui` `Button` ignores `active` except `tertiary` (client INSIGHTS 2026-10-25).
    - No hardcoded strings.
    - The NEW `context.json` keys must not contain the words "indexed"/"chunks" in any key T12 renders. Remove the stale `chunks`, `reindex`, `indexing`, `indexStatus`
      and `mode.edit`/`editor.save*` keys while here; they are unused after T6.
  - **Acceptance:** `pnpm test -- context-docs-picker` green with tests named by AC (each AC-22…AC-25 and AC-29…AC-32 runs for both
    variants; AC-26…AC-28 for the agent variant). `pnpm typecheck && pnpm lint` green.

- [x] **T12** Project Context page + sidebar item → AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20 → `client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.test.tsx`
  - **Action:** `app/repos/[repoId]/context/page.tsx` (thin RSC, async `params`, like `conventions/page.tsx`) →
    `_components/ProjectContextView/` (`"use client"`). It renders:
    - documents grouped by `specs`/`docs`/`insights` with paths, a path filter (case-insensitive) and a selected doc → `MarkdownPreview`;
    - a header "Used by N agents · M skills" from `useContextUsage`;
    - a refresh button → `refetch()` of the list (+ usage);
    - a skeleton while loading, an empty state naming `glob`, a not-cloned state, an error with retry, and a truncated notice ("only the first 500");
    - a summary "N documents · ≈ X tokens · refreshed <relative time from read_at>";
    - **no** create/upload/edit/delete control and no "indexed"/"chunks" wording.

    Page strings go in `messages/en/context.json` → `page.*`. **Sanctioned `vendor/ui` exception:** add
    `{ key: "context", label: "Project Context", icon: "FileText", href: "/repos/:repoId/context" }` (no `gKey`) to the
    WORKSPACE group of `client/src/vendor/ui/nav.ts` (precedent `75a1f6c`; this one line only, and the icon must exist in `vendor/ui/icons`).
  - **Module:** client · **Type:** ui
  - **Skills to use:** frontend-architecture, next-best-practices, react-best-practices, react-testing-library, security
  - **Owned paths:** `client/src/app/repos/[repoId]/context/**`, `client/messages/en/context.json` (after T11), `client/src/vendor/ui/nav.ts` (sanctioned one-line exception)
  - **Depends-on:** T6, T11
  - **Risk:** low
  - **Known gotchas:** `activeKeyFor` already maps `/context` → `"context"`. Never put an app-wide Suspense in the layout (client INSIGHTS
    2026-10-12). The relative-time formatter: reuse one if it exists, else a local helper in the view's `helpers.ts`.
  - **Acceptance:** `pnpm test -- ProjectContextView` green with tests named `AC-9`…`AC-20` (AC-13 asserts that a second fetch occurs and the new list
    renders); `pnpm typecheck && pnpm lint` green; `git diff client/src/vendor/ui` shows exactly the one nav item.

- [x] **T13** Agent editor Context tab → AC-21, AC-26, AC-27, AC-28, AC-32 (tab wiring) → `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.test.tsx` + `AgentEditor.test.tsx`
  - **Action:** add `"context"` to `AgentEditorView/constants.ts` `VALID_TABS` and to `AgentEditor/constants.ts` `TABS` (label key
    `agents.tabs.context`). Render `<ContextTab key={agent.id} agentId={agent.id} />` for `tab === "context"`. `ContextTab` reads
    `useActiveRepo()` and renders `<ContextDocsPicker kind="agent" …/>`. Add the i18n keys to `messages/en/agents.json`.
  - **Module:** client · **Type:** ui
  - **Skills to use:** frontend-architecture, react-best-practices, react-testing-library
  - **Owned paths:** `client/src/app/agents/[id]/_components/AgentEditor/**` (only `AgentEditor.tsx`, `constants.ts`, `AgentEditor.test.tsx`, new `_components/ContextTab/**`), `client/src/app/agents/[id]/_components/AgentEditorView/constants.ts`, `client/src/app/agents/[id]/_components/AgentEditorView/helpers.test.ts`, `client/messages/en/agents.json`
  - **Depends-on:** T11
  - **Risk:** low
  - **Known gotchas:** `parseTabParam` falls back to the first tab for unknown values, so update its test.
  - **Acceptance:** `pnpm test -- AgentEditor ContextTab` green; `/agents/:id?tab=context` renders the picker (RTL); `pnpm typecheck && pnpm lint` green.

- [x] **T14** Skill editor Context tab + "Serializes as" → AC-34, AC-35 (tab wiring), AC-36 → `client/src/components/skill-editor/_components/ContextTab/ContextTab.test.tsx` + `SkillEditorView.test.tsx`
  - **Action:** add `{ key: "context", icon: … }` to `skill-editor/constants.ts` `TABS`/`EditorTab`; render `ContextTab` in
    `SkillEditorView.tsx`. `ContextTab` shows the header "Project context to use · N attached", the hint "Any agent using this skill
    inherits these documents.", `<ContextDocsPicker kind="skill" …/>`, and below it a read-only "Serializes as" block: the line
    `## Project specifications` + one `- <path>` line per attached document, in order. i18n in `messages/en/skills.json`.
  - **Module:** client · **Type:** ui
  - **Skills to use:** frontend-architecture, react-best-practices, react-testing-library
  - **Owned paths:** `client/src/components/skill-editor/constants.ts`, `client/src/components/skill-editor/SkillEditorView.tsx`, `client/src/components/skill-editor/SkillEditorView.test.tsx`, `client/src/components/skill-editor/_components/ContextTab/**`, `client/messages/en/skills.json`
  - **Depends-on:** T11
  - **Risk:** low
  - **Known gotchas:** the skill's own prompt block and `skill_blocks` must not change (Non-goal); this tab is display + attachments only.
  - **Acceptance:** `pnpm test -- skill-editor` green with tests named `AC-34`, `AC-36`; `/skills/:id?tab=context` renders; `pnpm typecheck && pnpm lint` green.

### Phase 5 — AC tests (`test-writer`, `/run-plan` Step 3, after the architecture gate)

- [x] **T15** reviewer-core AC tests → AC-42, AC-43, AC-47 → `reviewer-core/test/prompt-project-context.test.ts`
  - **Action:** derive the tests from the spec first:
    - AC-42: path `a".md`, a path with `<` and a newline, and content `</untrusted>` + "ignore previous instructions". Exactly one opening/closing
      pair per document; the label contains no `"`, `<` or newline; `INJECTION_GUARD` is still in the system message.
    - AC-43: `PROJECT_CONTEXT_RULE` comes after the last spec block's `</untrusted>` and before the next `##`, and is not inside any `<untrusted>` span.
    - AC-47: no specs / `[]` → no `## Project context`, no rule; the T2 snapshot is unchanged.
    - Order: specs appear in the given order.
  - **Module:** reviewer-core · **Type:** core
  - **Skills to use:** typescript-expert, security
  - **Owned paths:** `reviewer-core/test/prompt-project-context.test.ts`
  - **Depends-on:** T2
  - **Risk:** low
  - **Known gotchas:** a red AC test means fixing the code, not the test.
  - **Acceptance:** `cd reviewer-core && npm test` green; every test name starts with its AC-ID.

- [x] **T16** Server AC tests (unit + integration) → AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-12, AC-13, AC-22, AC-24, AC-26, AC-27, AC-31, AC-33, AC-35, AC-37, AC-38, AC-39, AC-40, AC-41, AC-44, AC-45, AC-46, AC-47, AC-48, AC-49 → `server/test/project-docs-reader.test.ts`, `server/test/project-context-helpers.test.ts`, `server/test/project-context.it.test.ts`, `server/test/project-context-run.it.test.ts`
  - **Action:**
    - `project-docs-reader.test.ts` (unit, `mkdtemp` fixture clone):
      - AC-1: exact path set; a different glob → a different set.
      - AC-2: `.devdigest/specs/a.md` is in, `node_modules/p/docs/b.md` and `.git/…` are out.
      - AC-4: an empty file reads as `ok` with `''`; a binary file reads as `not_text`.
      - AC-7: `../../etc/passwd`, a symlink pointing outside, `node_modules/...` and a glob miss → `not_found`.
      - AC-8: a 1.1 MB file → `too_large`.
    - `project-context-helpers.test.ts`:
      - AC-3: the type rule, incl. `specs/x.md` + `docs/x.md` as two docs and `e2e/docs/specs/x.md` → `specs`.
      - AC-5: sort + 500 + `truncated`.
      - AC-40: dedupe and order.
      - AC-45: greedy 7k/7k/2k, null/>1 MB.
      - AC-12: `countUsage`.
    - `project-context.it.test.ts` (Docker, `buildApp` + `startPg`, fixture clone via `repos.clonePath`):
      - AC-1/4/5/6/7/8/13 through the routes. AC-13: add a file + empty one, call GET again, LLM mock call count 0.
      - AC-12: the usage endpoint.
      - AC-22: PUT then GET round-trip of the order.
      - AC-26: inherited rows (skill disabled globally → not inherited).
      - AC-31: `missing` flag (a deleted file; doc #501 is **not** missing).
      - AC-33: `../secret.md` and a non-existent path → 422 + 0 rows; empty `.md` accepted; doc #501 accepted.
      - AC-35: the same AC-33 cases on `/skills/:id/context`.
      - AC-37: rows hold no content.
      - AC-38: deleting an agent, skill or repo cascades.
      - AC-39: `agents.version` + latest skill version unchanged.
      - Cross-workspace → 404.
    - `project-context-run.it.test.ts` (mock LLM via `overrides.llm`, `overrides.tokenizer` for AC-45):
      - AC-24/AC-40: block order in `messages[1]` and `specs_read` order with agent + 2 skills + a duplicate path.
      - AC-41: the diff modifies an attached file; the prompt holds the clone version.
      - AC-44: missing + binary → run `done`, both `missing`, one log line each.
      - AC-45: 7k/7k/2k statuses.
      - AC-46: LLM call count with = without context.
      - AC-47: no attachments → no section and no rule.
      - AC-48: `specs_read` on success and on cancel after assembly.
      - AC-49: the shape for all statuses, an empty doc (`tokens:0`), a file grown past 1 MB (`over_budget`, `tokens:null`, log "> 1 MB"),
        and `prompt_assembly.specs === null`.
      - AC-27: the list `tokens` equals the trace `tokens` for the same files.
  - **Module:** server · **Type:** backend
  - **Skills to use:** fastify-best-practices (`rules/testing.md`), drizzle-orm-patterns, typescript-expert
  - **Owned paths:** `server/test/project-docs-reader.test.ts`, `server/test/project-context-helpers.test.ts`, `server/test/project-context.it.test.ts`, `server/test/project-context-run.it.test.ts`, `server/test/helpers/project-context-fixtures.ts` (optional)
  - **Depends-on:** T9, T10
  - **Risk:** medium
  - **Known gotchas:**
    - Start list-style tests from `pulls-list.it.test.ts` and skills-in-prompt tests from the `skills.it.test.ts` pattern (`mock.calls.find(c =>
      c.method === 'completeStructured')`) (server INSIGHTS 2026-10-16).
    - The integration tests skip without Docker (`dockerAvailable()`).
    - The 501-file fixture is generated in `mkdtemp`.
  - **Acceptance:** `pnpm test:unit` and `pnpm test:integration` green; every test name starts with its AC-ID.

### Phase 6 — Lab and verification

- [x] **T17** Manual lab run on a real model (user) → AC-54 → manual evidence in the PR description
  - **Action:**
    1. In a cloned repo, attach a document stating "module `api/` does not import `db/` directly" to an agent (Context tab).
    2. Open or use a PR where a file under `api/` imports from `db/`, and run the review.
    3. Check the trace: the path is in `specs_read`, and the persisted (post-grounding) findings include one on the import line of
       that file whose rationale names the document path.
    4. Paste the run id, the `specs_read` value and the finding into the PR description.
  - **Module:** server + client (operational) · **Type:** e2e (manual)
  - **Skills to use:** none
  - **Owned paths:** none (no code)
  - **Depends-on:** T10, T13
  - **Risk:** medium (model-dependent; the deterministic part is covered by T15)
  - **Known gotchas:** findings pointing at the spec file itself are dropped by `groundFindings()` (expected). Use a model that follows structured output reliably.
  - **Acceptance:** the evidence above is recorded. If the model misses it on the first run, rerun up to 3× and report n/3.

- [ ] **TV** `plan-verifier` against `specs/project-context.md` + this plan → matrix AC → task → test → commit for AC-1…AC-54, gate PASS
  - **Depends-on:** T1–T17

## Traceability
| AC | Tasks | Test(s) |
|---|---|---|
| AC-1 | T4, T9 | `project-docs-reader.test.ts` AC-1; `project-context.it.test.ts` AC-1 |
| AC-2 | T4 | `project-docs-reader.test.ts` AC-2 |
| AC-3 | T5 | `project-context-helpers.test.ts` AC-3 |
| AC-4 | T4, T9 | `project-docs-reader.test.ts` AC-4; `project-context.it.test.ts` AC-4 |
| AC-5 | T5, T9 | `project-context-helpers.test.ts` AC-5; `project-context.it.test.ts` AC-5 |
| AC-6 | T9 | `project-context.it.test.ts` AC-6 |
| AC-7 | T4, T9 | `project-docs-reader.test.ts` AC-7; `project-context.it.test.ts` AC-7 |
| AC-8 | T4, T9 | `project-docs-reader.test.ts` AC-8; `project-context.it.test.ts` AC-8 |
| AC-9 | T12 | `ProjectContextView.test.tsx` AC-9 |
| AC-10 | T12 | `ProjectContextView.test.tsx` AC-10 |
| AC-11 | T6, T12 | `MarkdownPreview.test.tsx`; `ProjectContextView.test.tsx` AC-11 |
| AC-12 | T5, T9, T12 | `project-context-helpers.test.ts` AC-12; `project-context.it.test.ts` AC-12; `ProjectContextView.test.tsx` AC-12 |
| AC-13 | T9, T12 | `project-context.it.test.ts` AC-13; `ProjectContextView.test.tsx` AC-13 |
| AC-14 | T12 | `ProjectContextView.test.tsx` AC-14 |
| AC-15 | T12 | `ProjectContextView.test.tsx` AC-15 |
| AC-16 | T12 | `ProjectContextView.test.tsx` AC-16 |
| AC-17 | T12 | `ProjectContextView.test.tsx` AC-17 |
| AC-18 | T12 | `ProjectContextView.test.tsx` AC-18 |
| AC-19 | T12 | `ProjectContextView.test.tsx` AC-19 |
| AC-20 | T9, T12 | `ProjectContextView.test.tsx` AC-20 |
| AC-21 | T11, T13 | `ContextDocsPicker.test.tsx` AC-21; `ContextTab.test.tsx` (agent) AC-21 |
| AC-22 | T6, T9, T11 | `ContextDocsPicker.test.tsx` AC-22 [agent, skill]; `project-context.it.test.ts` AC-22 |
| AC-23 | T6, T11 | `ContextDocsPicker.test.tsx` AC-23 [agent, skill] |
| AC-24 | T11, T10 | `ContextDocsPicker.test.tsx` AC-24 [agent, skill]; `project-context-run.it.test.ts` AC-24 |
| AC-25 | T11 | `ContextDocsPicker.test.tsx` AC-25 [agent, skill] |
| AC-26 | T9, T11, T13 | `project-context.it.test.ts` AC-26; `ContextDocsPicker.test.tsx` AC-26 |
| AC-27 | T11, T13, T9, T10 | `ContextDocsPicker.test.tsx` AC-27; `project-context-run.it.test.ts` AC-27 |
| AC-28 | T11, T13 | `ContextDocsPicker.test.tsx` AC-28 |
| AC-29 | T6, T11 | `ContextDocsPicker.test.tsx` AC-29 [agent, skill] |
| AC-30 | T11 | `ContextDocsPicker.test.tsx` AC-30 [agent, skill] |
| AC-31 | T9, T11 | `project-context.it.test.ts` AC-31; `ContextDocsPicker.test.tsx` AC-31 [agent, skill] |
| AC-32 | T11, T13, T14 | `ContextDocsPicker.test.tsx` AC-32 [agent, skill] |
| AC-33 | T4, T9 | `project-context.it.test.ts` AC-33 (agent endpoint) |
| AC-34 | T14 | `ContextTab.test.tsx` (skill) AC-34 |
| AC-35 | T11, T14, T9 | `ContextDocsPicker.test.tsx` [skill] AC-22…25, AC-29…32; `project-context.it.test.ts` AC-35 (skill endpoint, AC-33 cases) |
| AC-36 | T14 | `ContextTab.test.tsx` (skill) AC-36 |
| AC-37 | T3, T8 | `project-context.it.test.ts` AC-37 |
| AC-38 | T3, T8 | `project-context.it.test.ts` AC-38 |
| AC-39 | T8, T9 | `project-context.it.test.ts` AC-39 |
| AC-40 | T5, T9, T10 | `project-context-helpers.test.ts` AC-40; `project-context-run.it.test.ts` AC-40 |
| AC-41 | T4, T9, T10 | `project-context-run.it.test.ts` AC-41 |
| AC-42 | T2 | `prompt-project-context.test.ts` AC-42; existing `prompt-structured.test.ts`, `prompt-callers.test.ts` unmodified |
| AC-43 | T2 | `prompt-project-context.test.ts` AC-43 |
| AC-44 | T4, T9, T10 | `project-context-run.it.test.ts` AC-44 |
| AC-45 | T5, T9, T10 | `project-context-helpers.test.ts` AC-45; `project-context-run.it.test.ts` AC-45 |
| AC-46 | T9, T10 | `project-context-run.it.test.ts` AC-46 |
| AC-47 | T2, T10 | `prompt-no-context.test.ts` (snapshot); `prompt-project-context.test.ts` AC-47; `project-context-run.it.test.ts` AC-47 |
| AC-48 | T10 | `project-context-run.it.test.ts` AC-48 |
| AC-49 | T1, T9, T10 | `project-context-run.it.test.ts` AC-49 |
| AC-50 | T7 | `RunTraceDrawer.test.tsx` AC-50 |
| AC-51 | T7 | `RunTraceDrawer.test.tsx` AC-51 |
| AC-52 | T7 | `RunTraceDrawer.test.tsx` AC-52 |
| AC-53 | T1, T7 | `RunTraceDrawer.test.tsx` AC-53 |
| AC-54 | T17 (deterministic part: T2/T15) | manual lab run (evidence in the PR); `prompt-project-context.test.ts` AC-42/AC-43 |

## Testing strategy
- Tests are derived from the ACs, not from the finished code. `test-writer` writes T15/T16 after the
  architecture gate, reading the spec first, and names every test with its AC-ID. A red AC test means fixing
  the code. The UI tests are outside `test-writer`'s scope, so the implementers of T6, T7 and T11–T14 write
  colocated RTL tests named by AC. AC-35 parity comes from `describe.each(['agent','skill'])` in the picker test.
- One test is written by an implementer **before** the change it guards: T2's `prompt-no-context` snapshot
  (AC-47 "before/after").
- Commands:
  - `server`: `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration` (Docker), `pnpm arch:check`
  - `client`: `pnpm typecheck`, `pnpm lint`, `pnpm test`
  - `reviewer-core`: `npm run typecheck`, `npm test`
  - contracts: `./scripts/check-shared.sh`
  - e2e: none (deferred)
  - Prefix `PATH="$HOME/Library/pnpm/bin:$PATH"` for pnpm/docker in bash.
- NFR checks (no AC):
  - p95 list ≤ 2 s on a 500-file / 5 MB fixture: a one-off timing assertion in `project-context.it.test.ts`, warn-only.
  - Accessibility (checkbox names contain the path, ↑/↓ reorder, type badge as text): asserted in the picker RTL tests.
- After the run: `/pr-self-review` (manual; not yet run), then `--scope branch` before the PR.

## Risks & mitigations
- **Known limitation, accepted (2026-10-28):** the list and filter show only the first 500 documents. In
  the UI there is no way to newly attach a document past position 500; the `truncated` notice (AC-18) is the
  accepted handling. Existing attachments past 500 stay valid and are not shown as missing (AC-31/AC-33 use
  the full set). No extra task.
- **Path traversal / symlink escape** (security boundary) → all checks sit in one adapter (`read`), use realpath against the
  clone root and the strict UTF-8 decode, and are covered by the T16 unit tests with real symlinks in `mkdtemp`. Routes accept a path only
  through that adapter.
- **List latency over 2 s** (pure-JS tiktoken) → a token cache keyed by (path, size, mtime), and only the first 500 are tokenized.
  The attachments GET only reads tokens for owner/inherited paths.
- **Prompt regression for every review** (T2) → a snapshot captured before the change, AC-47 tests in reviewer-core and on the server,
  and the existing tests left unmodified.
- **Version bump by accident** (AC-39) → attachments live in their own tables and never go through
  `AgentsRepository.replaceSkills` / `SkillsService`. Covered by the integration test.
- **Cross-module coupling / cycles** → executor → `container.projectContext` only; service deps are local structural types;
  `pnpm arch:check` in every server task, and the baseline must not grow.
- **Validation status** → path rejection is a `ValidationError` (422), like Zod shape errors; the `rejected` paths go in `details` (documented in README by T9).
- **Shared-file collisions in a parallel run** → `container.ts` (T4 → T9) and `context.json` (T11 → T12) are chained, not
  concurrent. `run-executor.ts` is owned by T10 alone.
- **`vendor/ui` exception creep** → T12 may change only the one nav item; reviewers check `git diff client/src/vendor/ui`.
- **The client and server budget helpers drift apart** → both are tested with the same 7k/7k/2k + null + >1 MB cases. T16's AC-27 compares list vs. trace tokens.
- **Map-reduce cost** → the section repeats per file (an accepted edge case). The log line shows the tokens, so the cost is visible.
- **AC-54 is model-dependent** → a manual run with up to 3 attempts reported as n/3. The deterministic guarantees (AC-42/AC-43) are unit-tested.
- **pnpm version/PATH** → `~/Library/pnpm/bin`; `npx -y pnpm@12.4.1` as the fallback. The lockfile changes only through `pnpm add`.

## Red-flags check
- [x] Spec was `approved`, with no open `[NEEDS CLARIFICATION]`; it was not edited by the planner
- [x] Every AC (AC-1…AC-54) maps to ≥ 1 task and ≥ 1 test; every task lists its AC-IDs (T1 is scaffolding for all server/client ACs; T6 is scaffolding for the UI ACs, AC-11/AC-29 render)
- [x] Execution mode is recorded (multi-agent, `max-parallel:2`) and the plan is shaped for it
- [x] Dependencies form a DAG (no cycles; every `Depends-on` points to an earlier task)
- [x] (multi-agent) Concurrent tasks have non-overlapping Owned paths (`container.ts` T4→T9 and `context.json` T11→T12 are chained)
- [x] Every Acceptance is measurable (a command result or an AC-named test)
- [x] Every decision records its rejected alternative
- [x] Edits to existing shared contracts are called out explicitly (`trace.ts` additive `spec_blocks`; `adapters.ts` additive port)
- [x] No edit to an existing migration (a new `0016_*` only via `pnpm db:generate`); no cross-module import that `pnpm arch:check` forbids
- [x] The one do-not-touch exception (`client/src/vendor/ui/nav.ts`, one item) was sanctioned by the user and is marked in T12
- [x] Final phase runs `plan-verifier`
