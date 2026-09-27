# PR list — FINDINGS across agents

Status: implemented (2026-09-27); SCORE aligned with the DevDigest Field
Manual the same day (see **Score**).

Make the Pull Requests list's FINDINGS column reflect **every agent** that
reviewed a PR, not only whichever agent happened to finish last.

## Problem

`GET /repos/:id/pulls` took the single newest `reviews` row per PR
(`kind='review'`) and built `findings_by_severity` + `findings_preview` from
that one review. Since the multi-agent Run Review
([client/specs/multi-agent-selection.md](../../client/specs/multi-agent-selection.md)),
one click writes **one `reviews` row per agent** (`reviews.agent_id`,
`reviews.run_id`). With three agents, the list showed the findings of one of
them — silently, with nothing saying the other two existed.

## Semantics

- **FINDINGS = sum over the latest review of each agent.** For every
  `(pr_id, agent_id)` the newest `kind='review'` row wins; its findings are
  counted. A re-run of the same agent *replaces* that agent's previous result,
  it does not stack on top of it.
- Reviews with `agent_id = null` (legacy / seeded rows) form one
  "unattributed" bucket per PR — the newest of them wins, like any agent.
- A reviewed PR with zero findings still returns `{0,0,0}`; a never-reviewed
  PR returns `null` (unchanged).
- SCORE is derived from exactly these findings — see **Score** below.

## Score

The list's SCORE = `scoreFromFindings()` over **the same findings the FINDINGS
column counts** (every agent's latest review):
`100 − 35·CRITICAL − 12·WARNING − 3·SUGGESTION`, zero findings ⇒ 100, clamped
to 0…100. Never reviewed ⇒ `null`.

Source — the DevDigest Field Manual
(https://claude.ai/code/artifact/0a48487e-35e3-47f8-88c9-eb75111bb814):

- **Sheet 05, Fig. 5 ("DERIVED, NEVER TRUSTED")** — the formula above, and
  "Computed from the survivors — the number can never contradict the list."
- **Closing paragraph** — "the score under it is recomputed from exactly those
  findings."
- **Sheet 07, "Multi-agent review"** — agents are shown side by side, each
  with its own result → each agent's group in the popover shows that agent's
  own `reviews.score`.

The function is the engine's own (`reviewer-core/src/review/reduce.ts`,
re-exported from `reviewer-core/src/index.ts`), so the list and the review
run share one penalty table.

## Contract (`PrMeta`, list endpoint only)

- `findings_by_severity` — kept; now the sum over every agent group below.
- `findings_preview` — **removed**, replaced by:

```ts
findings_by_agent: Array<{
  agent_id: string | null;    // null = review with no agent (legacy/seed)
  agent_name: string | null;  // null = unattributed or since-deleted agent
  review_id: string;
  score: number | null;       // this agent's reviews.score (null = legacy row)
  findings_by_severity: SeverityCounts;
  findings: Finding[];        // severity-sorted, NOT capped
}> | null                     // null = never reviewed
```

Groups are sorted by agent name (null last). The severity-counts object is
extracted to a named `SeverityCounts` schema so both fields share it.

## UI

- The cell keeps the compact **summed** `SeverityPills` (one row, same height).
- The hover popover groups findings **by agent**: a header per agent (name,
  its own score ring, its own non-interactive pills), then that agent's findings. Groups with no
  findings are skipped. Title: "N FINDINGS · M AGENTS".
- The PR-detail Timeline keeps using the flat popover mode unchanged.

## Rejected alternatives

- **Sum of every review ever.** Would match PR-detail's `runs.flatMap` count
  exactly, but re-running the same agent would count the same issues twice or
  more — the column would grow with every retry without the PR getting worse.
- **Keep `findings_preview` alongside `findings_by_agent`.** Backwards-
  compatible on paper, but ships every finding twice; the only consumer is
  `PRRow`, and a flat list is trivially derivable from the groups.
- **SCORE = mean of per-agent scores.** The manual's "findings concatenated,
  worst verdict wins, scores averaged" (Sheet 03, "Large diffs") describes
  `reduceReviews` merging file SLICES of ONE agent's map-reduce run — not a
  rule for combining agents. A mean also contradicts the findings beside it.
- **SCORE = minimum per-agent score.** Conservative, but it reflects one
  agent's findings, not the summed column next to it.
- **One row of pills per agent in the cell.** Most information at a glance,
  but makes every reviewed row taller and the table uneven; the breakdown fits
  the popover, which already exists for "show me more".

## Known gaps

- PR-detail still counts **every** run (`page.tsx` → `runs.flatMap`). After an
  agent is re-run, the detail page's total is higher than the list's.
  Accepted: the detail page is a run history, and each run's own score already
  matches that run's findings.
- The same issue reported by two agents is counted — and penalised — twice.
  Merging duplicates belongs to the multi-agent "conflicts" screen
  (`/repos/:id/multi-agent/:prId`, Field Manual Sheet 07), which this repo does
  not have. Out of scope.

## Acceptance

- Two agents, A re-run once: list FINDINGS = A's newest findings + B's.
- Popover shows two sections with agent names and per-agent pills.
- SCORE = 100 − 35·C − 12·W − 3·S of the summed pills (1 C + 1 W + 1 S ⇒ 50,
  the Sheet 05 worked example); reviewed and clean ⇒ 100.
- Each popover group shows its agent's own score.
- Pill click still deep-links to `?tab=findings&severity=…`.
