# Workflow retro ledger

One row per `/workflow-retro` run (appended by the skill, newest last), so the cost and shape of
multi-agent runs can be compared over time. Details of a run, when saved, live next to this file as
`<date>-<label>.md`.

| date | label | agents | in→out tok | cache hit | wall | parallelism | cost | top recommendation |
|------|-------|--------|-----------|-----------|------|-------------|------|--------------------|
| 2026-10-28 | project-context (run-plan + pr-self-review, deep) | 48 (48 top-level + 0 nested; 22 sonnet, 26 opus) | 1.5k in + 46.1M cache-read + 7.4M cache-write → 676k | 86% | 77.7 min | 1.45x | n/a | Add a correctness pass to the run-plan gate: arch-review PASSed, then pr-self-review found 8 WARN (ENOTDIR→500, save races) |
