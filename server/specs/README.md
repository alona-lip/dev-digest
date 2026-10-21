# server/specs

Specifications and requirements for `server` features — one file per
feature/epic (e.g. a new module from a future course lesson), written before
implementation starts.

Keep: the goal, the contract (which routes/schemas will appear), acceptance
criteria, and what's explicitly out of scope.

## Contents

- [run-cost.md](./run-cost.md) — run cost end to end: price sources, the
  "null is not zero" invariant, and the per-PR SUM shown in the list.
- [pr-list-findings-by-agent.md](./pr-list-findings-by-agent.md) — PR-list
  FINDINGS column summed over each agent's latest review, grouped by agent in
  the popover.
- [onion-architecture.md](./onion-architecture.md) — the ring map for server +
  reviewer-core, the two deliberate exceptions, dependency-cruiser enforcement
  with a known-violations baseline, and the rejected alternatives.
- [security-hardening.md](./security-hardening.md) — clone-URL validation and
  path containment, GitHub token passed as a header (never in `.git/config`),
  loopback bind, 5xx/log hygiene, test-then-save keys, the review-persist
  transaction, untrusted PR title.
- [skill-import-url.md](./skill-import-url.md) — Add skill → Import from URL:
  server-side fetch behind an SSRF guard (public addresses only, checked at
  connect time), github blob → raw, same parser as a file import.
- [skill-injection-scan.md](./skill-injection-scan.md) — prompt-injection scan of
  skill bodies: pattern scan on every save + LLM Re-scan, saved-but-blocked,
  run-time drop; why it does not contradict `INJECTION_GUARD`.
- [conventions-pending-status.md](./conventions-pending-status.md) — conventions
  triage: new candidates start PENDING, the list hides REJECTED, the dedupe still
  sees them; why the filter is server-side.
- [onion-burn-down.md](./onion-burn-down.md) — the deliberate pass over the
  dependency-cruiser baseline: pulls/settings/polling/workspace onto
  service + repository, ports out of `src/adapters`, intended behaviour changes.
- [seed-skill-bindings.md](./seed-skill-bindings.md) — `db:seed` creates the
  `docs/skills-examples` skills and binds them (enabled, in order) to Test
  Quality / API Contract Reviewer, linking only agents that have no links yet.
