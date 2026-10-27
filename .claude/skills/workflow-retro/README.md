# Workflow Retro Skill

A **retrospective** for a finished multi-agent run — `/run-plan`, the spec → plan → implement chain,
a `Workflow()` fan-out, or any batch of sub-agents. It reports **what the run cost, where it
struggled, what it wasted and what to change next time**, and logs one trend row to
[`docs/retros/ledger.md`](../../../docs/retros/ledger.md) so runs can be compared.

Ported from the course branch `lesson-5-lab/sdd-finish`; adapted to this repo's agents
(`spec-creator`, `implementation-planner`, `restrict-writes.sh` denials, the two fix loops of
`/run-plan`) and made `disable-model-invocation`, like `pr-self-review`.

## Manual only

Type `/workflow-retro` after a run worth reviewing. It is not wired to any hook, `Stop` /
`SubagentStop` event, or the tail of another skill, and must not be added to `settings.json` —
retros cost tokens, so you choose when to spend them.

## Counts nested sub-agents

`spec-creator` / `implementation-planner` fan out `researcher`s, and `implementer` / `test-writer`
can spawn helpers. A parent's in-context `<usage>` excludes its children, so for such runs use
`deep`: journals are flat in `subagents/`, each with a `.meta.json` carrying `agentType` +
`spawnDepth`, and all depths are summed.

```
finished multi-agent run
  └─ scope the run            (which agents / which batch)
       └─ collect metrics      (in-context by default · `deep` parses JSONL journals)
            └─ analyse          (cost/resources + process + qualitative)
                 └─ recommend   (duplicated context · shared pre-read · split/merge role · concurrency · model · cache)
                      └─ report to chat  +  one trend row → docs/retros/ledger.md
```

## Usage

```
/workflow-retro label:<feature-slug> deep
/workflow-retro scope:session no-ledger
```

| Token | Meaning | Default |
|-------|---------|---------|
| `label:<slug>` | Name of the run under review | derived from run / date |
| `deep` | Parse on-disk JSONL journals (exact tokens, cache, tools, timing) | off |
| `session:<id>` | Session to parse in `deep` mode | current session |
| `scope:last` / `scope:session` | Most recent batch, or every agent in the session | `last` |
| `no-ledger` | Print only; skip the ledger row | off |

## Cost estimate

Prices are **not** hard-coded — they drift. Confirm current per-model rates via the `claude-api`
skill and pass them with `--prices prices.json`; without them cost shows `n/a`.

## File structure

```
workflow-retro/
├── SKILL.md                     ← analyst: scope → collect → analyse → recommend → report
├── README.md                    ← this file
└── scripts/
    └── analyze_journals.py      ← read-only, stdlib-only JSONL parser for `deep` mode
```

## Relationship to other skills

- `/run-plan` **builds** a feature; `workflow-retro` looks **back** at how the run performed.
- `engineering-insights` records durable technical findings per module in `<module>/INSIGHTS.md`;
  `workflow-retro` is about the **process**, and its durable output is the ledger.
