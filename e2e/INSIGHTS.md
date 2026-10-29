# Insights — e2e

Accumulated lessons, non-trivial decisions, traps we've already run into.

Append-only: add to the bottom of the matching section, never rewrite or
delete. A finding that supersedes an older one gets its own dated entry; the
old entry stays. Format — `- YYYY-MM-DD — what is true. What to do or avoid
next time. (path/file.ts:42)`. Written by the `engineering-insights` skill, or
by hand in the same format.

## What Works

## What Doesn't Work

<!--
- 2026-09-18 — example entry: state what turned out to be true, then what to do
  or avoid next time, and point at the evidence. (`path/to/file.ts:42`)
-->

## Codebase Patterns

- 2026-09-21 — flow files assert the seeded finding count as literal text
  (e.g. `wait --text "3 findings"` in `04-pr-findings.flow.json`), so a
  change to `server/src/db/seed.ts`'s findings for PR #482 (adding/removing
  one) must update the matching flow's expected text in the same change, or
  the flow goes stale and starts failing (or worse, passes on an unrelated
  string match) without the DB actually being wrong.
  (`e2e/specs/04-pr-findings.flow.json`)
- 2026-09-23 — precise anchor for the entry above, which cited the flow file
  but no line (every entry needs `file:line`): the brittle literal is the
  `wait --text "3 findings"` step at (`e2e/specs/04-pr-findings.flow.json:13`),
  and the same count is restated in prose in the flow's `description` at `:3`
  — a seed change has to update BOTH, since the description is what the next
  reader trusts when deciding whether the assertion is still right.
- 2026-09-23 — the seed coupling now reaches LOCATORS, not just assertions:
  the severity filter chips render `label + count`, so a button's accessible
  name is "Critical 1", and `find role button --name "Critical"` no longer
  identifies it. A UI change that merely appends a number to a label silently
  invalidates every `--name` locator pointing at it, and nothing in
  `pnpm test` catches it — the client unit tests were green while this flow
  would have failed. After changing any user-visible label, grep `e2e/specs/`
  for `--name` and `--text` occurrences of the old string before assuming the
  suite still passes. (`e2e/specs/04-pr-findings.flow.json:11`)

- 2026-10-16 — flows `04-pr-findings` and `05-pr-diff` fail locally and deterministically at "open the PR row": `wait --url /pulls` returns as soon as the client redirect changes the URL, but the PR list is still fetching, so `find text … click` runs before the row exists (`02-repo-pulls-detail` passes because it has `wait --text` before the click). Not a product regression. Put a `wait --text <row text>` before any `find text … click` that follows a navigation; the same race bit `08-skills` after clicking an agent card (wait for the editor's own text first). (`e2e/specs/04-pr-findings.flow.json`)

## Tool & Library Notes

- 2026-10-16 — `agent-browser find role button click --name Skills` is unambiguous only because the sidebar entry is a `link` and the editor tab is a `button` (`agent-browser snapshot -i` shows roles). A `find last "button:has-text('…')"` CSS-pseudo selector does not work here. To run flows by hand: copy `scripts/e2e.sh` with the final `(cd e2e && npm test)` replaced by `sleep`, then drive `agent-browser` against :3100 and `E2E_BASE_URL=http://localhost:3100 npm test`. `pnpm` must be on PATH for `e2e.sh`. (`e2e/docs/specs/skills.md`)

- 2026-10-19 — `./scripts/e2e.sh` starts its own `next dev` in `client/` (`scripts/e2e.sh:148`),
  i.e. on the SAME `client/.next` a running `pnpm dev` on :3000 serves from — stop the :3000
  dev server first and restart it afterwards. The script also requires `pnpm` and
  `agent-browser` on PATH; when they are not installed globally, tiny PATH shims
  (`exec npx -y pnpm@12.4.1 "$@"`, `exec npx -y agent-browser@0.39.1 "$@"`) work, at the cost of
  an npx start-up per step. (`scripts/e2e.sh:148`)

- 2026-10-20 — `find role button --name X` matches a case-insensitive SUBSTRING by default
  (`agent-browser find --help`). In `08-skills`, `--name "From file"` would also hit the empty
  state's "Import from file" button that sits BEHIND the open modal, so a click there lands on
  the overlay and closes the modal. Add `--exact` whenever one visible label is contained in
  another. (`e2e/specs/08-skills.flow.json`)

- 2026-10-29 — `wait --text` matches the rendered `innerText`, so CSS `text-transform` applies:
  `SectionLabel` is `uppercase`, and `10-pr-brief` failed in CI at `wait --text "Risk areas"`
  although the i18n string is exactly that. Client unit tests (RTL reads `textContent`) stayed green.
  When a flow asserts a heading, check the rendering component's style, not just
  `client/messages/en/*.json`, and write the text as displayed (`RISK AREAS`, like `SKILLS LAB` in
  08/09). (`client/src/vendor/ui/primitives/SectionLabel.tsx:22`, `e2e/specs/10-pr-brief.flow.json:12`)

## Recurring Errors & Fixes

## Session Notes

## Open Questions

- 2026-10-19 — three back-to-back hermetic runs (npx shims) gave 8/9, 9/9, 8/9: `09-conventions`
  failed once at `wait --text "Conventions in payments-api"` (right after `wait --url` +
  `networkidle` passed) and `02-repo-pulls-detail` once at "open the PR row" — likely the same
  "URL changes before the data renders" race as the 2026-10-16 entry. Neither reproduced
  locally (warm or cold `.next`), and the failure screenshot was blank, so the cause is
  unconfirmed. (low confidence) (`e2e/specs/09-conventions.flow.json:11`)

