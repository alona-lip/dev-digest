# reviewer-core/specs

Specifications for changes to the review engine — one file per feature (e.g.
a new prompt slot from a future course lesson: `skills`, `memory`, `specs`,
`callers`, `reduce`).

Keep: the goal, input/output (the contract), acceptance criteria, and what's
explicitly out of scope.

## Contents

- [grounding.md](./grounding.md) — the citation gate: the intersection rule, the
  full-file exception, and why it's mechanical rather than a second LLM call.
- [engine-hardening.md](./engine-hardening.md) — delimiter escaping, untrusted PR
  title, grounding bounded by the diff, exact `sliceDiff`, provider timeouts
  and the cost rule across repair attempts; rejected alternatives.
