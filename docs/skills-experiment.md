# Control experiment: the same PR, with and without skills

Goal: show that skills change what an agent finds — and that you can see it in the
run trace. The result depends on the model, so this is a **manual** procedure; it
is not an automated test.

## Setup (once)

1. `./scripts/dev.sh`, open <http://localhost:3000>, and add the repo with the PRs below.
2. **Skills → Add Skill** and add the examples from [skills-examples](./skills-examples/README.md):
   - *Import from file*: `test-quality/branch-coverage.md`, `api-contract/route-breaking-change.md`.
   - *Create skill* (paste the body): `test-quality/corner-cases.md`, `api-contract/contract-compat.md`.
   - *Import from file* a `.zip` of `test-quality/test-smells/` — the preview must list `scripts/run.sh` as **executable / ignored**. Confirm with **Save skill**.
3. Do **not** bind any skill yet.

## A. Test Quality Reviewer

PR: adds a function with an `if`/error branch and a test that only covers the happy path.

1. Run **Test Quality Reviewer** on the PR (no skills). Open the run trace → *Prompt assembly*: there is **no** Skills block. Note the findings (expect: the uncovered branch is missed).
2. Agents → Test Quality Reviewer → **Skills** tab: tick `branch-coverage`, `corner-cases`, `test-smells`. Order = prompt order.
3. Run it again on the same PR. Trace → *Prompt assembly* shows one block per skill with `+N tokens` and a total. The review now flags the uncovered branch and the missing boundary case.

## B. API Contract Reviewer

PR: changes a route signature (renames a field or makes a param required).

1. Run **API Contract Reviewer** with no skills → breaking change missed.
2. Bind `route-breaking-change` and `contract-compat` on its **Skills** tab → run again → the breaking change is reported.

## Checks

- Untick one skill on the tab and re-run: its block is gone from the trace **and** from the run log (the log lists only enabled skills as `Skill "<name>" v<n> (+<tokens> tokens)`).
- Turn a skill off with the toggle on **Skills → card**: it disappears from every agent's runs at once.
- Skills → *Stats* of a skill fills in after runs (pull rate, accept rate, findings by category) — a correlation, not proof.
