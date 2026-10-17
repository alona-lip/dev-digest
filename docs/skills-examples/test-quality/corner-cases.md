---
name: corner-cases
description: Use when a diff adds tests for a function that takes input. Check the tests against the boundaries of that input — empty, zero, one, max, null/undefined, duplicates, wrong type — and report the boundary the tests skip.
type: rubric
---
# Corner cases

For each function the diff tests, read its parameters and ask which boundaries matter:

- **Collections:** empty, one element, duplicates, very large.
- **Numbers:** `0`, negative, the exact limit, limit ± 1, `NaN`.
- **Strings:** empty, whitespace only, very long, unicode.
- **Optional values:** `null`, `undefined`, missing key.
- **Time and order:** same timestamp, out-of-order input.

Report the boundary the tests do not exercise **when the code has behaviour that depends on it** (a comparison, a loop bound, a default). Say which input to add and what it should assert.

Do not ask for boundaries the function cannot receive (a value its type or validation already rules out).
