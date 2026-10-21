# Data formats

All intermediate files go in the scratchpad directory, never in the repo.

## Finding

```json
{"bucket":"Backend","skill":"onion-architecture","file":"server/src/modules/x/routes.ts",
 "line_start":12,"line_end":20,"severity":"CRITICAL","title":"…",
 "rule":"routes stay thin","mechanism":"…",
 "waived":false,"deterministic":false}
```

After verification, `severity` is the verifier's severity; if two skills report
the same `file` + overlapping lines + the same issue, keep one finding and put
the other skill in `skill` joined by `, `.

## Check (from `checks.mjs`)

`{name, status: pass|fail|skipped, severity: CRITICAL|WARNING, summary, tail?, cached?, deterministic: true}`
A `fail` with severity CRITICAL blocks and is never waivable.

## Route (from `route.mjs`)

`{buckets: {name: {files, skills: {skill: [files]}}}, caps, focus, uncovered, ignored, deleted}`
— each file is in exactly one bucket. Human view: [../routing.md](../routing.md).

## Not reviewed

`["Backend/drizzle-orm-patterns", …]` — (bucket, skill) pairs whose reviewer
never returned valid JSON. Each one blocks.

## Verdict (written by `report.mjs` under `.git/pr-self-review/`)

`{scope, head, fingerprint, base, verdict: PASS|BLOCK, blocking: [string],
critical_count, dirty, findings, checks, not_reviewed, stats, reviewed_at}`

| Scope | File | Read by |
|---|---|---|
| `uncommitted` | `wt-<fingerprint>.json` — fingerprint = HEAD + content of every uncommitted path | `gate.sh check --worktree` ("is it done?") |
| `branch` | `<HEAD>.json` (+ `<HEAD>.pr.md` on PASS) | push / PR gate; `dirty: true` never opens it |

## Waivers (`.pr-self-review-waivers.json`, repo root, committed)

```json
[{"file":"server/src/modules/x/routes.ts","rule":"routes stay thin",
  "skill":"onion-architecture","reason":"why this is a false positive",
  "expires":"2026-11-10","author":"alona"}]
```

`file` may be a glob. `reason` is required; `expires` must be a date at most
30 days ahead. Invalid or expired waivers are ignored and reported.
