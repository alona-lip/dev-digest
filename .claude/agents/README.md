# DevDigest Agents

Custom Claude Code subagents for the DevDigest project. Each agent is a Markdown file with YAML
frontmatter (`name`, `description`, `model`, `tools`, optional `skills:`) plus a system-prompt body.
Claude routes work to an agent based on its `description`, so the descriptions are written as
trigger rules ("Use proactively when…").

Ported from the course branches `lesson-4-lab/mcp-start` and `lesson-5-lab/sdd-finish` and adapted
to this repo: insights live in `<module>/INSIGHTS.md`, agent instructions in `AGENTS.md` (each
`CLAUDE.md` is a symlink), the check gate includes `pnpm arch:check`, and `pr-self-review` /
`workflow-retro` are manual-only, so agents never run them — they tell the user they have not been
run yet.

| Agent | Model | Role | Writes |
|-------|-------|------|--------|
| [`spec-creator`](./spec-creator.md) | opus | WHAT & WHY — feature spec with EARS ACs, six clarification categories, design analysis | Only the spec (`<module>/specs/`, `e2e/docs/specs/`, `specs/`) — hook-enforced |
| [`researcher`](./researcher.md) | sonnet | Facts from code, MCP and the web, every claim with a locator | Only `docs/plans/<feature>.research.md`, on request — hook-enforced |
| [`implementation-planner`](./implementation-planner.md) | opus | HOW & IN WHAT ORDER — verifies the spec, asks multi/single-agent, plan with AC-IDs per task | Only `docs/plans/<feature>.md` — hook-enforced |
| [`implementer`](./implementer.md) | sonnet | Implements ONE plan task (backend or UI), self-verifies | Code, inside its Owned paths |
| [`architecture-reviewer`](./architecture-reviewer.md) | sonnet | Read-only structural review of a diff | Nothing |
| [`test-writer`](./test-writer.md) | sonnet | Tests derived from the spec's ACs (server + reviewer-core) | Test files only |
| [`plan-verifier`](./plan-verifier.md) | sonnet | Read-only final gate: AC → task → test → commit | Nothing |
| [`doc-writer`](./doc-writer.md) | sonnet | Long-lived documentation (Diátaxis + Mermaid) after implementation | Markdown docs |

## SDD pipeline

`spec-creator` answers **what and why**; `implementation-planner` answers **how and in what order**.
Six agents form the tight loop; `researcher` (facts before planning) and `doc-writer` (long-lived
docs afterwards) matter but are not required for every feature.

```
request + design sources
  └─ spec-creator (opus) → <module>/specs/<feature>.md            Status: draft → approved (by you)
       (six clarification categories · devdigest MCP · [NEEDS CLARIFICATION] · EARS AC-1…N)
       └─ [researcher → docs/plans/<feature>.research.md]          optional
            └─ implementation-planner (opus) → docs/plans/<feature>.md
                 (spec check · multi- or single-agent? · every task → AC-N → test)
                 └─ /run-plan plan:docs/plans/<feature>.md
                      ├─ implementer ×N (sonnet)                   ≤ max-parallel at once
                      ├─ architecture-reviewer ‖ correctness reviewers (sonnet) → fix loop
                      ├─ test-writer (sonnet) — tests from ACs → red test = fix the CODE
                      └─ plan-verifier (sonnet) — runs the suites; AC → task → test → commit, final gate
                           └─ /pr-self-review (manual) → commit → /workflow-retro (manual) → docs/retros/ledger.md
                                └─ [doc-writer]                    optional
```

| Agent | Receives | Produces | How we check it |
|-------|----------|----------|-----------------|
| `spec-creator` | feature request + verified facts | `spec.md` with EARS criteria | every AC is atomic, verifiable and does not contradict another |
| `researcher` | the spec + code / MCP | `research.md` | claims point to real files, symbols or data |
| `implementation-planner` | `spec.md` + research results | `plan.md` mapping tasks to ACs | plan review — by another model if needed |
| `implementer` | one or more plan tasks | a code diff | tests and the review gate (architecture + correctness) |
| `test-writer` | `spec.md`, ACs first | a test per criterion | tests come from requirements, not from the finished code's behaviour |
| `architecture-reviewer` | the diff + `docs/` + `AGENTS.md` | findings with references | the project's architectural invariants |
| `plan-verifier` | spec, plan and finished implementation | a completeness report | every AC has an implementation and a check |

**Why tests come after the architecture gate.** Architecture fixes move code between files; tests
written earlier would be rewritten. The risk of writing tests against finished code — copying the
implementer's mistake — is covered by `test-writer` reading the spec before the code, naming every
test with its AC-ID, and the `/run-plan` rule that a red AC test means fixing the code, never the
test.

**Older specs.** Specs written before this pipeline combine spec and plan in one
`<module>/specs/<feature>.md` (with `R1…` requirements). They stay as they are; `plan-verifier`
reads them by their `R`-ids.

## Write restrictions (hooks)

The three agents that write documents get a `PreToolUse` hook in their frontmatter, matching
`Write|Edit|MultiEdit|NotebookEdit` and calling
[`.claude/hooks/restrict-writes.sh`](../hooks/restrict-writes.sh) with their role:

| Role | Allowed paths |
|------|---------------|
| `spec` (`spec-creator`) | `<client\|server\|reviewer-core\|mcp-server>/specs/*.md`, `e2e/docs/specs/*.md`, `specs/*.md` |
| `plan` (`implementation-planner`) | `docs/plans/*.md` except `*.research.md` |
| `research` (`researcher`) | `docs/plans/*.research.md` |

Any other path exits 2: the call is blocked and the reason goes back to the agent. The script fails
closed (no `jq` → blocked). The rule is also in each prompt; the hook is what makes it hold.

## Budget

Before a long workflow, check the budget on the usage dashboard — limits depend on the plan and the
model, so there is no universal number. Expensive models are kept only where judgement dominates
(`spec-creator`, `implementation-planner` on opus); the read-only reviewers moved from opus to
sonnet because they follow structured checklists. On the first runs `/run-plan` keeps
`max-parallel:2`, `max-fix:2` and `e2e:smoke`, but never switches off typecheck, unit tests or
`pnpm arch:check` — without them you cannot see whether the pipeline itself works. After a full run,
`/workflow-retro deep` (nested agents included) turns the numbers into actions and logs a row in
[`docs/retros/ledger.md`](../../docs/retros/ledger.md).

**Questions from subagents.** Subagents may run in the background, where `AskUserQuestion` is not
available. `spec-creator` and `implementation-planner` then return a *Questions for the user* block
and stop; the main session asks you and resumes the agent with `SendMessage`.

---

## `researcher`

Read-only research agent. Finds information inside the project (code, docs, config, the read-only
devdigest MCP tools) or on the public internet and returns it in a strict template. In the SDD
pipeline, a brief with `feature:<slug>` makes it save the result to
`docs/plans/<slug>.research.md` — its only possible write. Never runs deep-research.

---

## `spec-creator`

**What it does.** Turns a request plus design sources (text, Figma links, screenshots, existing
specs, the code) into one feature spec — the WHAT and WHY. It walks the request through DevDigest's
six clarification categories (Data & loading · Display & sorting · Interactions · State &
persistence · Feedback · Edge cases), checks the live system through the read-only devdigest MCP
tools (`list_agents`, `get_findings`, `get_conventions`, `get_blast_radius` — never
`run_agent_on_pr`), and analyses the design for gaps, uncovered corner cases, communication between
modules and UX improvements. Blocking questions and UX proposals go to the user; the rest becomes
`[NEEDS CLARIFICATION]` instead of a guess. Specs are written in English; acceptance criteria are EARS
(WHEN / WHILE / IF … THEN / WHERE + `shall`) with `AC-N` ids; inputs carry provenance tags
(`[reused: …]`, `[deterministic: …]`, `[new: N LLM call]`). Spec IDs are a global `SPEC-NN` counter.

**Based on:**

- **Spec-Driven Development, spec vs plan split, `[NEEDS CLARIFICATION]`** — [GitHub Spec Kit](https://github.com/github/spec-kit), [Spec-Driven Development with Agentic AI (ArceApps)](https://arceapps.com/blog/spec-driven-development-ai/)
- **EARS** — [Easy Approach to Requirements Syntax (Mavin et al.)](https://alistairmavin.com/ears/)
- **Acceptance criteria an agent can verify** — [BrainGrid](https://www.braingrid.ai/blog/how-to-write-acceptance-criteria-ai-agent-can-verify)
- **Per-subagent hooks and MCP tools in `tools:`** — [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents), [Hooks reference](https://code.claude.com/docs/en/hooks)
- Reference implementation — course branch `lesson-5-lab/sdd-finish` (`.claude/agents/spec-creator.md`)

---

## `implementation-planner`

**What it does.** Formerly `planner`. Takes an **approved** spec and writes the Implementation Plan
— `docs/plans/<feature>.md`. It no longer clarifies requirements: it first verifies the spec
(atomic ACs, clear condition and response, no contradictions, behaviour not implementation, explicit
non-goals, no open `[NEEDS CLARIFICATION]`, `Status: approved`) and sends it back to `spec-creator`
if it fails. Then it raises implementation questions, recommends better approaches, and asks whether
to execute **multi-agent** (parallel, non-overlapping Owned paths) or **single-agent** (one linear
pass). Every task lists the `AC-N` it closes and the test that proves it; the plan has a
`Traceability` table, a `Decisions` table with rejected alternatives, and a final `plan-verifier`
phase. Carries the implementer's full skill set plus `mermaid-diagram`.

**Based on:**

- **`description` as the routing signal**, written as a trigger rule — [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents), [Best practices for Claude Code subagents (PubNub)](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- **Read-only planning, separated from implementation** (Explore → Plan → Implement) — [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- **Opus for design/architecture** (model tiering) — [wshobson/agents](https://github.com/wshobson/agents)
- **Strong plan structure** — [affaan-m/everything-claude-code · planner.md](https://github.com/affaan-m/everything-claude-code/blob/main/agents/planner.md)
- **Plan anti-patterns → the Red-flags check** — [Strategic Task Planner (subagents.app)](https://subagents.app/agents/planner)
- **Preloading skills via `skills:`** — [Extend Claude with skills](https://code.claude.com/docs/en/skills)
- **Requirements traceability (AC → task → test)** — [How to create a traceability matrix (Perforce)](https://www.perforce.com/blog/alm/how-create-traceability-matrix)
- Reference implementation — course branch `lesson-5-lab/sdd-finish` (`.claude/agents/implementation-planner.md`)

---

## `implementer`

**What it does.** Implements exactly one task from an Implementation Plan (`docs/plans/`) — backend (Fastify/Drizzle/
onion) or UI (Next.js/React) — and brings it to green. Runs in parallel with other implementers on
the **same branch** (no worktree isolation), so staying inside the task's `Owned paths` is what
keeps the parallel run safe. It reads the ACs its task closes and reports them (`Closes: AC-…`). Its self-check is narrow: write the code and make the module's existing
tests + typecheck pass; broad review is left to `pr-self-review`.

**Skill routing.** All relevant skills (backend + UI + core + always) are listed in the `skills:`
frontmatter and injected at startup, so nothing has to be invoked manually. The body just states
which set to emphasise per task `Type`.

**Based on:**

- **`description` as a trigger rule** for auto-delegation — [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents)
- **Sonnet for implementation** (model tiering) — [wshobson/agents](https://github.com/wshobson/agents)
- **Per-type skill sets injected via `skills:`** (backend vs UI vs core) — [Extend Claude with skills](https://code.claude.com/docs/en/skills)
- **Owned paths / forbidden files / contracts-first** for safe parallel work — [Parallel Claude Code Agents: Safe Workflow Guide](https://www.aakashx.com/blog/parallel-claude-code-agents/)
- **Self-verification with a runnable check** (tests + typecheck, iterate to green) — [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- **Review in a fresh context, separate from the author** — [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices); kept in the existing `pr-self-review` skill rather than baked into this agent
- **Single-responsibility agent design** (one task, in scope) — [wshobson/agents](https://github.com/wshobson/agents), [PubNub best practices](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- **Module-scoped insights read before coding, written back after** — project convention in [`/AGENTS.md`](../../AGENTS.md) + the `engineering-insights` skill

**Deliberately not used:** `isolation: worktree` (the project runs implementers on the main branch
by choice, relying on `Owned paths` discipline instead of worktree isolation).

---

## `test-writer`

**What it does.** Adds or extends unit and integration tests for the DevDigest backend (`server/`)
and the LLM review engine (`reviewer-core/`). It enforces the project's test split (`*.it.test.ts`
= real Postgres via testcontainers, `server/test/helpers/pg.ts`; `*.test.ts` = hermetic unit with
fake timers and seeded ids), injects `MockLLMProvider` (server) or a stub `LLMProvider`
(reviewer-core) at the LLM seam — every provider a run can reach, so a test never uses real keys, and never modifies production `src/` files (only a type export strictly
required to compile a test is permitted). Forbidden anti-patterns are encoded directly in its body:
tautological assertions, over-mocking, snapshot tests on dynamic output, and non-deterministic test
bodies. Self-verifies by running the affected suites and pasting terminal evidence before reporting
done. **Spec first:** given a spec, it writes test cases from the ACs before reading the
implementation, names each test with its AC-ID, and keeps a test red (reporting the mismatch) when
the code contradicts an AC — tests come from requirements, not from the finished code.

**Skill routing.** `react-testing-library` supplies RTL and vitest query conventions; `fastify-best-practices`,
`drizzle-orm-patterns`, and `onion-architecture` anchor the backend test structure to the actual layering;
`zod` and `typescript-expert` cover schema-level assertions; `security` and `engineering-insights`
are the always-on set.

**Based on:**

- **Subagent design and trigger-rule `description`** — [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents), [Best practices for Claude Code subagents (PubNub)](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- **Over-mocking and tautological-test study** — [Are Coding Agents Generating Over-Mocked Tests? (arXiv)](https://arxiv.org/html/2602.00409v1)
- **Tautological-test postmortem (contract-comment-before-assertion rule)** — [When AI-generated tests pass but miss the bug (dev.to)](https://dev.to/jamesdev4123/when-ai-generated-tests-pass-but-miss-the-bug-a-postmortem-on-tautological-unit-tests-2ajp)
- **Mocking LLM calls for deterministic tests** — [Unit testing AI agents: mocking LLM calls (CallSphere)](https://callsphere.ai/blog/unit-testing-ai-agents-mocking-llm-calls-deterministic-tests)
- **Blazing-fast Postgres tests with testcontainers + Vitest** — [Blazing fast Prisma and Postgres tests in Vitest (Codepunkt)](https://codepunkt.de/writing/blazing-fast-prisma-and-postgres-tests-in-vitest/)
- **Flaky-test prevention in Vitest** — [Flaky tests in Vitest (Mergify)](https://mergify.com/flaky-tests/vitest/)

---

## `architecture-reviewer`

**What it does.** A **read-only** structural auditor (`tools: Read, Glob, Grep` — no `Edit`,
`Write`, or `Bash`). Given a diff or file set, it reads the project's own authoritative docs first
(`AGENTS.md`, `server/AGENTS.md`, `server/.dependency-cruiser.cjs`, `server/docs/di-container.md`,
`reviewer-core/AGENTS.md`, `reviewer-core/docs/prompt-assembly.md`) and then checks seven named rules: inward-only dependencies,
business logic in routes, DI discipline, no `process.env` outside `LocalSecretsProvider`,
`reviewer-core` zero-I/O, `groundFindings()` gate, and shared-contract deduplication. Every finding
must cite the exact rule it violates; uncited generic opinions are suppressed. Write tools are
deliberately omitted — a reviewer that can write is tempted to fix rather than report, which destroys
review independence.

**Scope.** Does NOT review style nits, naming, runtime bugs, test quality, performance, or security
injection vectors (those belong to `pr-self-review` and the `security` skill). Structural contracts
only.

**Based on:**

- **Subagent design and trigger-rule `description`** — [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents), [Best practices for Claude Code subagents (PubNub)](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- **Parallel AI agents for code review** — [9 Parallel AI Agents That Review My Code (HAMY)](https://hamy.xyz/blog/2026-02_code-reviews-claude-subagents)
- **Architectural liquefaction and the need for automated guardrails** — [Clean Architecture in the Age of AI (dev.to)](https://dev.to/uxter/clean-architecture-in-the-age-of-ai-preventing-architectural-liquefaction-5d8d)
- **Enforcing Clean Architecture via tooling** — [Enforce Clean Architecture in TypeScript with fresh-onion (dev.to)](https://dev.to/remojansen/enforce-clean-architecture-in-your-typescript-projects-with-fresh-onion-45pi)
- **Agentic code review patterns** — [Agentic Code Review (Addy Osmani)](https://addyosmani.com/blog/agentic-code-review/)

---

## `plan-verifier`

**What it does.** The **final gate** of the SDD pipeline and a **read-only** completeness checker
(`tools: Read, Glob, Grep, Bash` — no `Edit` or `Write`). Given the spec and the Implementation
Plan, it walks every acceptance criterion `AC-N` and traces it to a plan task, a test and a commit;
searches for the concrete implementing artifact (grep → structural glob → read), quotes verbatim
evidence, and assigns one of four statuses: `done | partial | missing | cannot-verify`. `Bash` is
used only to run grep/typecheck commands and capture output as evidence — never to modify state.
After the per-requirement pass it performs an implicit-concerns sweep (error handling, auth,
idempotency, test coverage, type safety). Output is a traceability matrix table followed by a gate
verdict, plus coverage gaps (AC without task, AC without test, task without AC).

**Skill routing.** The skill set is intentionally lean: `typescript-expert` to locate TypeScript
artifacts, `onion-architecture` to know where backend artifacts should live, and
`frontend-architecture` to locate UI artifacts. No architecture-quality or security skills are
loaded — those concerns belong to `architecture-reviewer` and `pr-self-review`. The body explicitly
states this agent's mandate is completeness and traceability only.

**Based on:**

- **Spec-driven development with AI** — [Spec-Driven Development with Agentic AI (ArceApps)](https://arceapps.com/blog/spec-driven-development-ai/)
- **Writing acceptance criteria AI agents can verify** — [Acceptance criteria an AI agent can verify (BrainGrid)](https://www.braingrid.ai/blog/how-to-write-acceptance-criteria-ai-agent-can-verify)
- **Code search tool selection for AI agents** — [Code search for AI agents — which tool, when (ceaksan.com)](https://ceaksan.com/en/code-search-for-ai-agents-which-tool-when)
- **LLM behavioral failure modes (hallucination, rubber-stamping)** — [LLM behavioral failure modes (ceaksan.com)](https://ceaksan.com/en/llm-behavioral-failure-modes)
- **What AI verification still misses** — [AI coding agents can verify some of their work — here's what they still miss (dev.to)](https://dev.to/moonrunnerkc/ai-coding-agents-can-verify-some-of-their-work-now-heres-what-they-still-miss-58mc)
- **Requirements traceability matrix structure** — [How to create a traceability matrix (Perforce)](https://www.perforce.com/blog/alm/how-create-traceability-matrix)

---

## `doc-writer`

**What it does.** Writes and updates Markdown documentation for the DevDigest codebase. Every
claim is grounded in source (never invented); every doc is classified into a Diátaxis quadrant
(tutorial / how-to / reference / explanation) and placed according to the repo's layout decision
tree (`<module>/docs/`, `docs/`, `<module>/specs/`, `specs/`, `<module>/INSIGHTS.md`). Recorded
decisions are append-only — superseded by a dated "As built" section or a new INSIGHTS entry, never
rewritten. Every generated file is stamped with
`<!-- generated from: <source files> -->` on the second line. Mermaid diagrams are selected by
content type and validated with a post-check (unique node ids, no lowercase `end`, correct arrow
syntax) before publishing.

**Skill routing.** `mermaid-diagram` drives diagram type selection and syntax; `onion-architecture`
and `frontend-architecture` are loaded to accurately describe backend and UI module structure in
reference docs; `typescript-expert` enables accurate reading of TypeScript types and exported
symbols; `engineering-insights` closes the loop — doc-writing discoveries (undocumented constraints,
gotchas) are appended back to `<module>/INSIGHTS.md`.

**Based on:**

- **Diátaxis framework** — [Diátaxis — Start Here](https://diataxis.fr/start-here/)
- **Automated, grounded documentation generation (DocAgent)** — [DocAgent (arXiv)](https://arxiv.org/html/2504.08725v1)
- **AI doc generation: when it helps and when it misleads** — [AI can write your docs, but should it? (Mintlify)](https://www.mintlify.com/blog/ai-can-write-your-docs-but-should-it)
- **Architecture Decision Record conventions** — [Architecture Decision Record (Martin Fowler)](https://martinfowler.com/bliki/ArchitectureDecisionRecord.html)
- **ADR best practices** — [Master ADRs (AWS)](https://aws.amazon.com/blogs/architecture/master-architecture-decision-records-adrs-best-practices-for-effective-decision-making/)
- **Avoiding AI writing pitfalls** — [avoid-ai-writing SKILL.md (GitHub)](https://github.com/conorbronsdon/avoid-ai-writing/blob/main/SKILL.md)

---

## Adding a new agent

1. Create `<name>.md` here with frontmatter (`name`, `description`, `model`, `tools`, optional
   `skills:`).
2. Write the `description` as a trigger rule — it is the only signal Claude uses to route to the agent.
3. If you preload skills, make sure none of them set `disable-model-invocation: true` (that blocks
   preloading).
4. Add a row to the table above and a section here, with sources if the design is based on external
   practices.
