# Spec: Project Context — module `INSIGHTS.md` files as `insights` documents
Spec ID: SPEC-02
Status: approved
Supersedes: [SPEC-01](../../specs/project-context.md) AC-1, AC-3

## Problem and user

Project Context (SPEC-01, implemented) lists only `specs` and `docs` documents; the `insights` group is
always empty. The defect is in SPEC-01 itself, and the code implements it faithfully:

- SPEC-01 AC-1's default glob `**/{specs,docs,insights}/**/*.md` matches only files **inside** an
  `insights/` directory. DevDigest's own convention keeps insights as **files** —
  `<module>/INSIGHTS.md` (`server/`, `client/`, `reviewer-core/`, `e2e/`, `mcp-server/`); no `insights/`
  directory exists. Verified: `server/INSIGHTS.md` does not match, `insights/a.md` does.
- SPEC-01 AC-3 types a document by its deepest **directory** segment and ignores the file name, so
  `server/INSIGHTS.md` would be typed `docs` even if it passed the glob.
- Tests missed it: fixtures use a synthetic `insights/c.md` directory and a test-local copy of the glob,
  never the real layout.

The user — an agent author / tech lead attaching project knowledge to reviewers — cannot attach the
lessons-learned files that the repo's own workflow produces (written by the `engineering-insights`
skill), which are exactly the "lessons from incidents" SPEC-01 was meant to feed into reviews.

The wire contract (`type: 'specs' | 'docs' | 'insights'`) and the client (group order, picker badge)
already handle `insights`; only the server's matching and typing rules change.

## Goals / Non-goals

- Goal: under the default configuration, every file named `INSIGHTS.md` (file name compared
  case-insensitively) at any depth is listed, previewable and attachable, and is typed `insights`.
- Goal: under the default configuration, the `specs` / `docs` / `insights` directory segments are matched
  and typed case-insensitively too (`Docs/`, `SPECS/`); the `.md` extension stays lowercase only.
- Goal: an operator whose `.env` still carries the old SPEC-01 default is told so at server start.
- Goal: everything SPEC-01's default matched still matches (including `insights/` directories), and
  everything it excluded is still excluded.
- Goal: tests exercise the repository's real layout and the real default, not a synthetic stand-in.
- Non-goal: per-repository glob configuration in the UI (unchanged from SPEC-01).
- Non-goal: other file-name-typed conventions — `AGENTS.md`, `CLAUDE.md`, `README.md`, ADRs.
- Non-goal: any change to the wire contract (shape, `type` enum, `glob: string`) or to the client.
- Non-goal: any change to the token budget, the 1 MB limit, the 500-item list limit, or the prompt
  assembly / untrusted-block handling.
- Non-goal: rewriting a `CONTEXT_GLOB` the operator set explicitly (it replaces the default, under the
  same case rule, AC-10).

## User stories

- As a tech lead, I want each module's `INSIGHTS.md` to appear in the Project Context `insights` group,
  so that I can attach a module's lessons learned to the agent that reviews it. → AC-2, AC-5, AC-8, AC-9
- As an existing user, I want every document I could see and attach before to stay visible, attachable
  and typed as before, so that the fix does not break my configured agents. → AC-1, AC-3, AC-4, AC-6, AC-13
- As an operator who set `CONTEXT_GLOB` deliberately, I want my pattern used instead of the default, so that the
  default's new rule does not leak into my configuration. → AC-10
- As an operator whose `.env` was copied from the old environment example, I want a startup warning
  naming the new default, so that I learn why `INSIGHTS.md` files are missing. → AC-15
- As a user looking at the empty state or the server's environment example, I want the glob shown to be
  the one actually applied, so that I can understand why a file is or is not listed. → AC-11, AC-12, AC-16
- As a maintainer, I want the tests to mirror the real `<module>/INSIGHTS.md` layout and the real
  default, so that this class of bug is caught next time. → AC-14

## Acceptance criteria (EARS)

### Matching (supersedes SPEC-01 AC-1)

- AC-1: WHERE `CONTEXT_GLOB` is unset or empty, the system shall list every `.md` file under a directory
  segment named `specs`, `docs` or `insights` at any depth, comparing the segment name
  case-insensitively — a superset of what the SPEC-01 default listed.   _(observable: fixture clone with `specs/x.md`, `docs/y.md`, `insights/c.md`, `e2e/docs/specs/z.md`, `Docs/y.md`, `SPECS/x.md`, `Insights/c.md` → all seven in the list response)_
- AC-2: WHERE `CONTEXT_GLOB` is unset or empty, the system shall also list every file whose name is
  `INSIGHTS` (compared case-insensitively) followed by the lowercase extension `.md`, at any depth
  including the repository root.   _(observable: fixture with `server/INSIGHTS.md`, `INSIGHTS.md`, `a/b/insights.md`, `c/Insights.md` → all four listed)_
- AC-3: WHERE `CONTEXT_GLOB` is unset or empty, the system shall not list any other file, including any
  file whose extension is not exactly lowercase `.md`.   _(observable: same fixture plus `notes/random.md`, `README.md`, `server/AGENTS.md`, `notes/MY-INSIGHTS.md`, `notes/insights-old.md`, `INSIGHTS.MD`, `docs/y.MD` → none of these listed)_
- AC-4: The system shall keep SPEC-01 AC-2's exclusions and inclusions for `INSIGHTS.md` files: never
  list one under `node_modules/` or `.git/`, and list one in a hidden directory.   _(observable: fixture with `node_modules/p/INSIGHTS.md`, `.git/INSIGHTS.md`, `.devdigest/INSIGHTS.md` → only the last listed)_

### Typing (supersedes SPEC-01 AC-3)

- AC-5: The system shall type a document `insights` WHEN its file name equals `INSIGHTS.md` compared
  case-insensitively, regardless of the directories above it.   _(observable: unit test of the pure typing function — `server/INSIGHTS.md`, `INSIGHTS.md`, `a/b/insights.md`, `docs/INSIGHTS.md`, `specs/INSIGHTS.md` → `insights`)_
- AC-6: IF the file name is not `INSIGHTS.md` (any case), THEN the system shall type the document by its
  deepest directory segment that equals `specs`, `docs` or `insights` compared case-insensitively,
  defaulting to `docs`, and shall keep treating each full path as a distinct document.   _(observable: same unit test — `e2e/docs/specs/x.md` → `specs`, `insights/c.md` → `insights`, `docs/insights/n.md` → `insights`, `a/insights/b/docs/c/d.md` → `docs`, `Docs/y.md` → `docs`, `a/Specs/b.md` → `specs`, `INSIGHTS/c.md` → `insights`; `specs/x.md` and `docs/x.md` → two documents, `specs` and `docs`)_

### Content and attachments (SPEC-01 AC-7, AC-33 apply the new rule)

- AC-7: The system shall apply one and the same matching rule (AC-1 – AC-4, or the explicit
  `CONTEXT_GLOB` under AC-10) to the document list, the content endpoint and attachment validation.   _(observable: for every path in the AC-1 – AC-4 fixtures, "listed" ⇔ "content returned" ⇔ "attachment accepted")_
- AC-8: WHEN the client requests the content of an `INSIGHTS.md` file that AC-2 lists, the system shall
  return its text; all other SPEC-01 AC-7 refusals (traversal, symlink out of the clone, excluded
  directory) still return "not found".   _(observable: API test — `server/INSIGHTS.md` → 200 with the text; `node_modules/p/INSIGHTS.md` and `../INSIGHTS.md` → 404)_
- AC-9: WHEN the client saves attachments containing an `INSIGHTS.md` path that AC-2 lists, the system
  shall accept and store it; a path outside the rule still gets SPEC-01 AC-33's validation error.   _(observable: API test — saving `server/INSIGHTS.md` succeeds and the row is stored; saving `notes/random.md` → 422, 0 rows)_

### Configuration

- AC-10: WHERE `CONTEXT_GLOB` is set to a non-empty value, the system shall match that pattern instead
  of the default and add no `INSIGHTS.md` files implicitly; the typing rule (AC-5, AC-6) still applies to
  whatever it matches. The explicit pattern is matched with the same case rule as the default: path
  segments and file names ignore case, the `.md` extension must be lowercase.   _(observable: `CONTEXT_GLOB=**/specs/**/*.md` → `SPECS/x.md` listed, `server/INSIGHTS.md` and `specs/x.MD` not listed; `CONTEXT_GLOB=**/*.md` → `server/INSIGHTS.md` listed with type `insights`)_
- AC-11: The server's environment example and its API reference shall state the new default pattern,
  that it includes `INSIGHTS.md` files at any depth, that every pattern (default or custom) matches path
  names case-insensitively while the `.md` extension must be lowercase, and that an existing `.env` carrying the old value
  must be updated or blanked to get them.   _(observable: the `CONTEXT_GLOB` value in the environment example is identical to the built-in default; the comment and the API reference mention `INSIGHTS.md`)_
- AC-12: WHERE `CONTEXT_GLOB` is unset or empty, the list response's `glob` field shall remain a single
  string equal to the documented default from AC-11, so the empty state (SPEC-01 AC-15) names the rule
  actually applied.   _(observable: API test without `CONTEXT_GLOB` → `glob` is a string equal to the environment example's value)_
- AC-15: WHEN the server starts with `CONTEXT_GLOB` set to exactly the old SPEC-01 default
  `**/{specs,docs,insights}/**/*.md`, the system shall log one warning that names the new default, and
  shall otherwise keep using the configured old pattern unchanged.   _(observable: config/unit test — old value → exactly one warn-level log line containing the new default, and the effective pattern is still the old one; new default or a custom value → no such line)_
- AC-16: WHERE `CONTEXT_GLOB` is set to exactly the documented default string (as a fresh `.env` copied
  from the environment example is), the system shall list, type and validate documents identically to
  `CONTEXT_GLOB` being unset.   _(observable: the AC-1 – AC-4 fixture run twice — unset vs set to the environment example's value — yields identical list responses, including `Docs/y.md` and `SPECS/x.md`)_

### Regression and tests

- AC-13: The system shall keep every SPEC-01 acceptance criterion other than AC-1 and AC-3 unchanged,
  and every existing server test assertion shall pass unchanged, with one exception: the integration
  assertion that the list response's `glob` equals the old SPEC-01 default (with `CONTEXT_GLOB` unset) is
  superseded by AC-12 and shall instead expect the new documented default.   _(observable: existing server unit and integration suites green; the diff to existing tests touches only that single `body.glob` expectation; the `insights/c.md` fixture still matches)_
- AC-14: The test suite shall verify AC-1 – AC-6 against a fixture mirroring the repository's real layout
  (`server/`, `client/`, `reviewer-core/`, `e2e/`, `mcp-server/` each with an `INSIGHTS.md`) using the
  built-in default, not a test-local copy of the pattern.   _(observable: a test that fails if the built-in default stops matching `<module>/INSIGHTS.md`)_

## Edge cases

- `node_modules/**/INSIGHTS.md`, `.git/INSIGHTS.md` → still excluded → AC-4
- `INSIGHTS.md` in a hidden directory (`.devdigest/INSIGHTS.md`) → listed → AC-4
- `docs/INSIGHTS.md`, `specs/INSIGHTS.md` → matched by both old and new rules, typed `insights` (file name
  wins) → AC-1, AC-5
- A path SPEC-01 already listed changes type (e.g. a pre-existing `docs/INSIGHTS.md` attachment, formerly
  `docs`) → type is derived from the path on every read, not stored; the document now shows as `insights`
  → AC-5
- Existing attachments → keep their paths; no data migration (attachments store paths only) → AC-13
- Names that only resemble the convention (`MY-INSIGHTS.md`, `insights-old.md`, `insights.md.bak`) → not
  matched → AC-3
- Upper-case extension (`INSIGHTS.MD`, `docs/y.MD`) → not listed; only lowercase `.md` counts → AC-3
- Mixed-case directory segments under the default (`Docs/y.md`, `SPECS/x.md`, `Insights/c.md`) → listed
  and typed by the bucket, case-insensitively → AC-1, AC-6
- Fresh `.env` copied from the new environment example → `CONTEXT_GLOB` is explicitly set to the default
  string, behaves exactly like unset → AC-16
- An `.env` copied from the old environment example keeps the old explicit glob → still used, so that
  user sees no `INSIGHTS.md` files until they update or blank the line, but the server logs one warning
  at start naming the new default → AC-10, AC-11, AC-15
- Stale clone missing a newly added `INSIGHTS.md` (today the local clone lacks `mcp-server/INSIGHTS.md`)
  → the state as of the last sync is read → accepted: no handling (the existing Resync action updates it)
- An `INSIGHTS.md` larger than 1 MB → `too_large`, `tokens: null`, no content, not attachable, exactly as
  SPEC-01 AC-8 / AC-33 → AC-13
- More than 500 matches after the widening → truncated as SPEC-01 AC-5 → AC-13
- Repository with neither `specs/docs/insights` directories nor `INSIGHTS.md` → empty state naming the
  default → AC-12 (via SPEC-01 AC-15)

## Non-functional requirements

- Performance: unchanged SPEC-01 budget — document list p95 ≤ 2 s for 500 documents totalling ≤ 5 MB on a
  local clone; the widened rule adds 0 LLM calls, 0 network requests and no second walk of the clone.
- Security: the widening does not relax any boundary — only `.md` files, never under `node_modules/` or
  `.git/`, inside the clone after resolving symlinks, ≤ 1 MB for content and attachments (SPEC-01 AC-7,
  AC-33); verified by AC-4, AC-8, AC-9.
- Observability: exactly one warn-level log line at server start when `CONTEXT_GLOB` equals the old
  SPEC-01 default, naming the new default (AC-15); 0 such lines otherwise and none per request. The
  `glob` field in the list response remains the observable record of the pattern applied (AC-12).
- Accessibility: not applicable — no UI change.

## Inputs and provenance

| Input | Source |
|---|---|
| List of `.md` documents, type, size | [deterministic: clone working tree (default branch) + matching rule from server config] |
| Document type | [deterministic: pure function of the repository-relative path] |
| Default pattern string shown in the empty state | [reused: list response `glob` field, SPEC-01] |

No LLM calls. Module boundaries are unchanged from SPEC-01 (client → server → clone); the only contract at
a boundary that this spec constrains is the existing list response: `glob` stays a single `string`, `type`
stays `'specs' | 'docs' | 'insights'`.

## Untrusted inputs

`INSIGHTS.md` content and file names are repository text, handled exactly as every other Project Context
document under SPEC-01: content reaches the prompt only inside the `<untrusted>` blocks of the
`## Project context` section with `INJECTION_GUARD` applied, and path labels are neutralised (SPEC-01
AC-42). This spec adds no new channel.

## Open questions

None. Resolved 2026-10-28 (user):
- `INSIGHTS.MD` and other non-lowercase extensions are not matched (AC-3).
- Directory segments are matched and typed case-insensitively (AC-1, AC-6).
- The startup warning for the old default is in (AC-15).
- One case rule for every pattern: an explicit `CONTEXT_GLOB` is matched case-insensitively on path
  names, like the default, with the `.md` extension lowercase-only (AC-10, Option A); option B (literal
  match of a custom pattern) was rejected because two rules would be harder to explain (AC-11).
- 2026-10-28: the existing integration assertion `body.glob` = old SPEC-01 default contradicted AC-12;
  that single assertion is superseded by AC-12 and moves to the new default, all others stay (AC-13).
