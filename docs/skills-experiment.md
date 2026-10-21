# Control experiment: the same PR, with and without skills

Goal: show that skills change what an agent finds — and that you can see it in the
run trace. The result depends on the model, so this is a **manual** procedure; it
is not an automated test.

> Status: both experiments run on 2026-10-21 — results under each section and in
> [Conclusion](#conclusion). Model: `openrouter/deepseek/deepseek-v4-flash`, 3 runs per
> condition, PRs in `alona-lip/dev-digest`.

## Setup (once)

1. `./scripts/dev.sh`, open <http://localhost:3000>, and add the repo with the PRs below.
   Wait until the repo is indexed — the caller of a changed route reaches the prompt
   through the repo map.
2. `./scripts/dev.sh` already ran `pnpm db:seed`, which creates the skills from
   [skills-examples](./skills-examples/README.md) and binds them, switched on, to
   **Test Quality Reviewer** and **API Contract Reviewer**. Open each agent's **Skills** tab
   to check the order.
   - The seed only writes links for an agent that has **none**. An agent that already has
     older links keeps them (on 2026-10-21 API Contract Reviewer still had
     `route-breaking-change`, `contract-compat`, … instead of the set below). Fix the set by
     hand on the **Skills** tab.
   - The tab cannot unbind: a switched-off link and an unbound skill look the same. Bound
     skills are the top block (in prompt order), unbound ones follow alphabetically. A
     switched-off link never reaches the prompt, so stale links can simply stay off.
   - Only switched-on rows can be reordered: switch on, move with ↑/↓, switch off again —
     the row keeps its place.
   - Optional, to check the import path: delete `test-smells`, then *Import from file* a `.zip` of
     `test-quality/test-smells/`. The preview must list `scripts/run.sh` as **executable / ignored**.
     Confirm with **Save skill** and bind it again.
3. For the baseline runs, switch **off** every skill on the agent's **Skills** tab. The links
   and their order stay.

## A. Test Quality Reviewer

PR: adds a function with an `if`/error branch and a test that only covers the happy path.
Used: [alona-lip/dev-digest#3](https://github.com/alona-lip/dev-digest/pull/3) — `parsePullUrl(url)`
in `server/src/modules/repos/helpers.ts` with two throws (`!match` and `number < 1`), one
happy-path test in `server/test/repos-url.test.ts`.

1. Run **Test Quality Reviewer** on the PR (all its skills switched off). Open the run trace → *Prompt assembly*: there is **no** Skills block. Note the findings (the original expectation, "the uncovered branch is missed", did **not** hold — see results).
2. Agents → Test Quality Reviewer → **Skills** tab: switch `branch-coverage`, `corner-cases`, `test-smells` back on. Order = prompt order.
3. Run it again on the same PR. Trace → *Prompt assembly* shows one block per skill with `+N tokens` and a total. The review now flags the uncovered branch and the missing boundary case.

### Results (2026-10-21)

| | skills off (3 runs) | skills on (3 runs) |
|---|---|---|
| Untested error paths noticed | 3/3 | 3/3 |
| How they are reported | **one** lumped finding | **one finding per branch** (`!match`, `number < 1`) |
| Boundary `/pull/0` as its own finding | 0/3 (named inside the rationale only) | 3/3 |
| Severity of the main finding | CRITICAL ×1, WARNING ×2 | CRITICAL ×3 |
| Verdict | request_changes ×1, comment ×2 | request_changes ×3 |
| Score | 65 / 88 / 88 | 18 / 30 / 18 |
| Prompt tokens in | 5102 | 5649 (+532: 193 + 165 + 174) |
| Cost per run | $0.0003–0.0005 | $0.0005–0.0006 |

- The trace and the log match step 3: three blocks, and `Skill "<name>" v<n> (+N tokens)` per
  skill. Agent `config.version` 5 → 8 between the conditions.
- In one "on" run the grounding gate dropped a finding that cited a non-existent path
  (`server/src/test/…`).
- One run per condition answered in Chinese — a trait of this model, not of the skills.

**Reading:** on this PR the skills did not uncover anything the model missed; they made the
review **consistent and specific** — every branch is its own CRITICAL finding, the `0`
boundary is always reported, and the verdict is always "request changes".

## B. API Contract Reviewer

PR: changes a route signature (renames a field or makes a param required).
Used: [alona-lip/dev-digest#4](https://github.com/alona-lip/dev-digest/pull/4) — `RunRequest`
fields `agentId`/`agentIds` → `agent_id`/`agent_ids` in the server contract and in
`POST /pulls/:id/review`. The client caller (`useRunReview` in `client/src/lib/hooks/reviews.ts`)
and the client's vendored contract are not updated, so every "Run review" gets a 400. The PR
looks like a fix ("wire is snake_case"); CI catches it anyway (`check-shared.sh` and the
server integration tests go red).

1. Run **API Contract Reviewer** with its skills switched off → expected: breaking change missed (did **not** hold — see results).
2. Switch `breaking-change`, `response-schema`, `deprecation-policy` and `semver-discipline` back on on its **Skills** tab (check the order, see Setup 2) → run again → the breaking change is reported with the caller it breaks.

### Results (2026-10-21)

| | skills off (3 runs) | skills on (3 runs) |
|---|---|---|
| Breaking change found | 3/3, CRITICAL | 3/3, CRITICAL |
| Names the real caller (`hooks/reviews.ts` / `useRunReview`) | 1/3 — others say "any existing caller" | 2/3 — the third names the client's vendored contract |
| Wrong claims | 2/3: "fields are silently ignored" (it is a 400) | 2/3: `reviewer-core` named as a caller (it has no copy of the contract and never calls the route) |
| Mentions a missing deprecation / alias | 0/3 | 1/3 |
| Verdict / score | request_changes, 65 ×3 | request_changes, 65 ×3 |
| Prompt tokens in | 4470 | 6372 (+1829: 468 + 481 + 432 + 448) |
| Cost per run | $0.00025–0.0004 | $0.00024–0.0005 |

- No *callers digest* in any B run: a renamed Zod field has no callable signature. The caller
  reached the model through the **repo map** (`useRunReview` is in it) — Repo Intel, not the
  skills, made the caller findable.
- `reviewer-core` is listed as an example caller in the text of `breaking-change`; the model
  repeated it as a fact. A skill's examples can leak into findings.

**Reading:** with this model the skills gave no clear gain on B — the caller is named a bit
more often (2/3 vs 1/3), at +43 % prompt tokens and with a new invented caller.

## Checks

- Untick one skill on the tab and re-run: its block is gone from the trace **and** from the run log (the log lists only enabled skills as `Skill "<name>" v<n> (+<tokens> tokens)`).
  ✅ 2026-10-21: `response-schema` off → 3 blocks, `Skills: 3 attached (+1348 tokens)`, agent version 28 → 29.
- Turn a skill off with the toggle on **Skills → card**: it disappears from every agent's runs at once.
  ✅ 2026-10-21: `test-smells` off → Test Quality run has 2 blocks (+358 tokens).
  ⚠️ The agent `config.version` does **not** change (stays 8), so two runs with different
  skill sets share one version; tell them apart by the trace blocks / `run_skills`.
- Skills → *Stats* of a skill fills in after runs (pull rate, accept rate, findings by category) — a correlation, not proof.
  ✅ 2026-10-21: `branch-coverage` pull rate 0.22, 10 findings (`test`); `breaking-change` 0.44,
  4 findings (`bug`). Accept rate stays empty until findings are accepted/dismissed.
  `branch-coverage` is also bound to General Reviewer, so its stats mix two agents.

## Conclusion

- Skills changed **how** findings are reported more than **whether** they are found: in A the
  review became consistent (per-branch CRITICAL findings, explicit boundary), in B the result
  barely moved. The planned contrast "missed without skills, found with them" did not appear
  with this model on either PR.
- What made the difference visible is the trace: skill blocks and their token cost are exact
  and reproducible; the findings are not.
- Cost of skills is prompt size: +11 % (A) and +43 % (B) input tokens; per-run cost stayed
  well under $0.001.
- Limits: one model, n = 3 per condition, the author of the PRs knew what the skills look for.
  To get the contrast, try a weaker or older model, or a subtler PR (a branch hidden in a
  `??` fallback, a route whose caller is only in the repo map).
