---
name: branch-coverage
description: Use when a diff adds or changes a conditional, switch, early return or error path in production code. Check that a test in the same diff makes that exact branch run, and report each branch no test reaches.
type: rubric
---
# Branch coverage

For every production file the diff changes:

1. List the new or changed branches: `if`/`else`, ternaries, `switch` cases, `??`/`||` fallbacks, early returns, `catch` blocks.
2. For each branch, find a test in this diff (or an existing test the diff leaves intact) that makes it **run**. A test that only passes through the happy path covers none of the others.
3. Report each branch with no such test as a finding. Name the branch (file and line) and the input that would reach it.

Do **not** report a branch that is pure plumbing with no behaviour (a re-export, a type guard that the compiler already enforces).

Severity: a missing test for a new error path or a new permission/validation check is CRITICAL. A missing test for another new branch is WARNING.
