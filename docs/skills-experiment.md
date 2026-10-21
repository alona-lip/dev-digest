# Control experiment: the same PR, with and without skills

Goal: show that skills change what an agent finds — and that you can see it in the
run trace. The result depends on the model, so this is a **manual** procedure; it
is not an automated test.

## Setup (once)

1. `./scripts/dev.sh`, open <http://localhost:3000>, and add the repo with the PRs below.
2. `./scripts/dev.sh` already ran `pnpm db:seed`, which creates the skills from
   [skills-examples](./skills-examples/README.md) and binds them, switched on, to
   **Test Quality Reviewer** and **API Contract Reviewer**. Open each agent's **Skills** tab
   to check the order.
   - Optional, to check the import path: delete `test-smells`, then *Import from file* a `.zip` of
     `test-quality/test-smells/`. The preview must list `scripts/run.sh` as **executable / ignored**.
     Confirm with **Save skill** and bind it again.
3. For the baseline runs, switch **off** every skill on the agent's **Skills** tab. The links
   and their order stay.

## A. Test Quality Reviewer

PR: adds a function with an `if`/error branch and a test that only covers the happy path.

1. Run **Test Quality Reviewer** on the PR (all its skills switched off). Open the run trace → *Prompt assembly*: there is **no** Skills block. Note the findings (expect: the uncovered branch is missed).
2. Agents → Test Quality Reviewer → **Skills** tab: switch `branch-coverage`, `corner-cases`, `test-smells` back on. Order = prompt order.
3. Run it again on the same PR. Trace → *Prompt assembly* shows one block per skill with `+N tokens` and a total. The review now flags the uncovered branch and the missing boundary case.

## B. API Contract Reviewer

> Status: not run yet. The skills are ready; the experiment PR has not been created.

PR: changes a route signature (renames a field or makes a param required).

1. Run **API Contract Reviewer** with its skills switched off → breaking change missed.
2. Switch `breaking-change`, `response-schema`, `deprecation-policy` and `semver-discipline` back on on its **Skills** tab (the seed already put them in that order) → run again → the breaking change is reported with the caller it breaks.

## Checks

- Untick one skill on the tab and re-run: its block is gone from the trace **and** from the run log (the log lists only enabled skills as `Skill "<name>" v<n> (+<tokens> tokens)`).
- Turn a skill off with the toggle on **Skills → card**: it disappears from every agent's runs at once.
- Skills → *Stats* of a skill fills in after runs (pull rate, accept rate, findings by category) — a correlation, not proof.
