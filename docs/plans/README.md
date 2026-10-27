# plans

Implementation plans — the HOW and IN WHAT ORDER of a feature, written by the
`implementation-planner` agent from an **approved** spec
(`<module>/specs/<feature>.md` or `specs/<feature>.md`). One file per feature,
named after the spec: `<feature>.md`. Every task points to the `AC-N` it closes
and the test that proves it; `/run-plan plan:docs/plans/<feature>.md` executes
it and `plan-verifier` checks the AC → task → test → commit matrix at the end.

`<feature>.research.md` files are fact sheets from the `researcher` agent,
prepared for the `implementation-planner`.

Only these two agents write here (`.claude/hooks/restrict-writes.sh`).
