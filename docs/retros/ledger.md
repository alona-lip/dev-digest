# Workflow retro ledger

One row per `/workflow-retro` run (appended by the skill, newest last), so the cost and shape of
multi-agent runs can be compared over time. Details of a run, when saved, live next to this file as
`<date>-<label>.md`.

| date | label | agents | in→out tok | cache hit | wall | parallelism | cost | top recommendation |
|------|-------|--------|-----------|-----------|------|-------------|------|--------------------|
| 2026-10-28 | project-context (run-plan + pr-self-review, deep) | 48 (48 top-level + 0 nested; 22 sonnet, 26 opus) | 1.5k in + 46.1M cache-read + 7.4M cache-write → 676k | 86% | 77.7 min | 1.45x | n/a | Add a correctness pass to the run-plan gate: arch-review PASSed, then pr-self-review found 8 WARN (ENOTDIR→500, save races) |
| 2026-10-29 | project-context-insights (spec → plan → run-plan → pr-self-review, deep) | 15 (15 top-level + 0 nested; 2 opus, 13 sonnet) | 0.4k in + 10.5M cache-read + 2.6M cache-write → 224k | 80% | 40.9 min | 0.99x | n/a | spec-creator: grep tests for literals an AC changes before claiming "existing tests unchanged" (AC-13 cost 1 spec + 1 planner round) |
| 2026-10-29 | pr-brief (run-plan, deep; excl. pr-self-review) | 25 (25 top-level + 0 nested; 25 sonnet) | 0.9k in + 37.4M cache-read + 6.6M cache-write → 558k | 85% | 54.0 min | 1.58x | n/a | max-parallel 2→3 for implementation (T5 queued 11 min) + split test-writer per file: T11 unit alone took 19 min / 104k out |
