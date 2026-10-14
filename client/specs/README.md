# client/specs

Specifications and requirements for `client` features — one file per
feature/epic, written before implementation starts.

Format is free-form, but it helps to include: the goal, acceptance criteria,
and what's explicitly out of scope. `AGENTS.md` links here — files are read
only while working on the matching feature.

## Contents

- [severity-filter.md](./severity-filter.md) — findings severity counters, the
  pill/filter controls and the read-only popover.
- [structure-and-data-layer.md](./structure-and-data-layer.md) — thin route
  entries + Next file conventions, Suspense at the leaves (real 404s), query-key
  factories and invalidation, lint-enforced boundaries, user-event tests.
