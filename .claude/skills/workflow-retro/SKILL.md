---
name: workflow-retro
description: "MANUAL ONLY — type /workflow-retro; the model never starts it on its own. Retrospective for a finished multi-agent run (/run-plan, the spec-creator → implementation-planner → implementer chain, a Workflow() fan-out, any batch of sub-agents). Collects tokens, cache read, tool calls, durations, agent count, launch order and parallelism — nested sub-agents included (deep mode reads the on-disk journals, because a parent's usage excludes its children) — reconstructs what was hard, easy, duplicated or missed, and ends with concrete actions (drop duplicated context, pre-load a shared file once, split an overloaded role, lower concurrency). Prints the report and appends one trend row to docs/retros/ledger.md. Does NOT run the workflow, edit agents/skills or product code, push or merge."
disable-model-invocation: true
---

# Workflow Retro — retrospective for a multi-agent run

> **Hand me a finished multi-agent run and I tell you what it cost, where it struggled, what it
> wasted, and exactly what to change next time — then log a trend row so runs can be compared.**

You are the **analyst**, running in the main session. The workflow already ran; you look back at
it. You read metrics and reports, reason about them, and produce a report plus recommendations.
**You do not re-run the workflow and you do not edit agent/skill definitions or product code** — you
*recommend* changes; applying one is a separate step the user approves.

## Manual only — never automatic

Invoked by hand (`/workflow-retro`), after a run the user wants reviewed — `disable-model-invocation`
keeps the model from starting it. There is **no hook and there must never be one**: do not wire it to
`Stop`/`SubagentStop`/`PreToolUse`, do not chain it at the end of `/run-plan` or another skill, do not
register it in `settings.json`. Retros cost tokens; the user chooses when to spend them.

## Count nested sub-agents (do not undercount)

A sub-agent can spawn its **own** sub-agents: `spec-creator` and `implementation-planner` hold `Agent`
and fan out `researcher`s; `implementer`, `test-writer` and `doc-writer` hold `Agent` too. These
nested agents consume real tokens and **must be included** in the per-agent breakdown and every total.

- **In-context undercounts.** A parent's `<usage>` reports only its own tokens, not its children's.
- **Deep mode catches them.** Journals are stored **flat** in `subagents/`, so an `agent-*.jsonl` glob
  already includes every depth. Each journal has a sibling `<journal>.meta.json` with `agentType`,
  `description` and **`spawnDepth`** (1 = spawned by the main session, > 1 = nested). The helper
  indents nested agents and **sums all depths into the totals**.
- **Rule:** if the run used an agent that can spawn sub-agents — or you are not sure — prefer `deep`,
  or state in the report that in-context totals exclude nested agents.

## Inputs (args)

| Token | Meaning | Default |
|-------|---------|---------|
| `label:<slug>` | Name of the run under review (usually the feature slug) | derived from the run / date |
| `deep` | Parse the on-disk JSONL journals for exact token / cache / tool / timing data | off (in-context only) |
| `session:<id>` | Which session to analyse in `deep` mode | the current session |
| `scope:last` / `scope:session` | The most recent agent batch, or every agent in the session | `last` |
| `no-ledger` | Print the report only; skip the trend row | off |

If it is ambiguous *which* run to review (several batches in one session), ask before analysing.

## Data sources

1. **In-context (default).** As orchestrator you saw every `Agent` result's `<usage>` block
   (`subagent_tokens`, `tool_uses`, `duration_ms`), every `<task-notification>`, the launch order,
   which agents were dispatched in one message (parallel), and each final report. Enough for a solid
   retro with **zero file reads**.
2. **Deep (`deep`).** Per-turn input / output / **cache-read** / cache-creation tokens, tool calls,
   timestamps:
   - Subagent journals: `~/.claude/projects/<project-slug>/<session-id>/subagents/agent-*.jsonl`
   - Main session: `~/.claude/projects/<project-slug>/<session-id>.jsonl`
   - For this repo the slug is the working directory with `/` → `-`
     (`-Users-<you>-…-dev-digest`); the current session is the most recently modified `*.jsonl`.
   - Run the bundled helper (read-only, stdlib-only):
     ```
     python3 -I .claude/skills/workflow-retro/scripts/analyze_journals.py \
       "$HOME/.claude/projects/<project-slug>/<session-id>/subagents/agent-*.jsonl" --json
     ```
   - It prints per-agent and total tokens, **cache hit ratio**, tool calls, wall-clock span, and a
     **parallelism factor** (Σ agent spans ÷ wall-clock), with `nested=` / `max_depth=`. For a cost
     estimate pass `--prices prices.json`; **never hard-code prices — confirm current per-model rates
     via the `claude-api` skill first**.

## What to measure

Collect what you can; mark anything unavailable as `n/a` rather than guessing.

**Cost & resources**
- Tokens — input / output / cache-read / cache-creation, per agent and total.
- **Cache efficiency** = cache-read ÷ input-side tokens. A low ratio means something breaks the
  prompt cache — a big cost lever.
- Tool calls per agent and total; wall-clock per agent and total; **parallelism factor**;
  **critical path** (the agent that dominated wall-clock).
- Cost ($) only with verified prices, plus **cost per useful output** ($/AC closed, $/spec, $/task).

**Process & effectiveness**
- Agent count incl. nested (e.g. "6 agents: 4 top-level + 2 nested"), launch order, parallelism map.
- **Clarifying round-trips** per agent — high means the brief was underspecified.
- Rework — fix-loop iterations in `/run-plan` (architecture loop, test loop), retries, re-spawns.
- Delegation correctness — right agent per task; owned paths / scope respected; blocked writes from
  `restrict-writes.sh` (a hook denial = an agent tried to write outside its role).
- **Failure taxonomy** — API errors, tool denials, blocked-on-human.

**Qualitative**
- **What was hard** — stalls, loops, questions.
- **What was easy** — clean first-try work.
- **Duplicated information** — the same large file read by several agents, context re-sent,
  overlapping work → candidates for one shared pre-read.
- **What was missed** — gaps caught only afterwards (by `plan-verifier`, `/pr-self-review`, the human).

## Method

1. **Scope the run** (`scope`, or ask). List agents and roles.
2. **Collect metrics** — in-context, or `deep` via the helper. Build the per-agent table + totals.
3. **Analyse** — quantitative findings from the table, qualitative from reports and observation.
4. **Recommend** — each finding becomes a concrete, owned action (below).
5. **Output** the report. Unless `no-ledger`, append one row to `docs/retros/ledger.md` (create it
   with the header if missing). That row — and an optional full report file
   `docs/retros/<date>-<label>.md` — is the **only** write this skill makes.
6. **Offer**, never perform, the follow-up: "want me to apply recommendation N?"

## Recommendations — make them actionable

Each names a target, a change, and the expected payoff. The usual shapes:

- *Duplicated context:* "3 agents each read `docs/architecture.md` (~4k tokens ×3) — the orchestrator
  reads it once and passes the excerpt." → ~8k tokens saved per run.
- *Pre-load a shared file:* "every implementer re-read the spec — put the relevant ACs into each
  task brief." → fewer reads, smaller contexts.
- *Brief:* "`implementer` for T3 needed 2 round-trips on owned paths — add sibling tasks' owned paths
  to its brief."
- *Split / merge a role:* "`implementation-planner` spent 60% of tokens on discovery — run
  `researcher` with `feature:<slug>` first." / "A and B always run back-to-back on the same files —
  merge."
- *Concurrency:* "`max-parallel:3` caused rate-limit retries — drop to 2." / "reviewers ran serially
  on disjoint inputs — dispatch together."
- *Model:* "`plan-verifier` on sonnet missed nothing — keep it; `test-writer` needed 3 retries — try
  a stronger model for that role only."
- *Cache:* "hit ratio 38% — a dynamic block precedes the stable one; reorder."

## Output format (report)

```
## Workflow Retro — <label>

**Run:** <what ran> · <N> agents (<top-level> + <nested>) · mode <multi|single> · data: <in-context | deep>

### Metrics
| agent | role | in | out | cache-read | hit% | tools | span | cost |
|-------|------|----|-----|------------|------|-------|------|------|
**Totals:** in <…> · out <…> · cache hit <…>% · tools <…> · wall <…>s · parallelism <…>x · cost <…>
**Launch order:** A → (B ‖ C) → D     **Critical path:** <agent> (<…>s)

### What went well
- <…>

### What was hard / wasteful
- <stall> — <evidence>
- <duplicated context> — <which agents, ~tokens>
- <missed> — <caught when / by whom>

### Recommendations (actionable)
1. <target> — <change> → <expected effect>

### Ledger
Appended to `docs/retros/ledger.md`.
```

### Ledger row (`docs/retros/ledger.md`)

One Markdown table, one row per retro, so runs can be compared over time:

```
| date | label | agents | in→out tok | cache hit | wall | parallelism | cost | top recommendation |
|------|-------|--------|-----------|-----------|------|-------------|------|--------------------|
```

## When you cannot proceed

If no multi-agent run is in scope, or `deep` is requested but the journals cannot be found, say so
and offer the in-context retro instead. "Nothing to retro / journals not found" is a valid result —
a fabricated metric is not.
