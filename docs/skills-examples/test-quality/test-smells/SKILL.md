---
name: test-smells
description: Use when a diff adds or changes tests. Flag tests that mock the unit under test, assert on their own mocks, depend on time/randomness/network/ordering, or have no assertion that could fail.
type: rubric
---
# Test smells

Flag, with file and line:

- **Over-mocking:** the test replaces the unit it claims to test, or mocks so much that the assertion only proves the mock returned what it was told to.
- **Tests that cannot fail:** no assertion, `expect(true)`, an assertion on a value the test itself just set, a snapshot of everything.
- **Flakes:** real clocks (`Date.now`, timers) without fake timers, `Math.random`, network or filesystem access, shared state between tests, order-dependent tests, `setTimeout` used to "wait for" something.
- **Swallowed failures:** `try/catch` around the assertion, `.catch(() => {})`, async tests that do not `await`.

Report each smell once, with the concrete way it would let a regression through.
