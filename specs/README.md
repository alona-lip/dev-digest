# specs (repo-wide)

Specifications for changes that span several packages or the repo root —
written before the code, recording the rejected alternative with its reason
(root `AGENTS.md`, Session protocol). A change inside one package belongs in
that package's `specs/` instead: [client](../client/specs/README.md) ·
[server](../server/specs/README.md) · [reviewer-core](../reviewer-core/specs/README.md).

## Contents

- [agents-md.md](./agents-md.md) — `AGENTS.md` as the source of agent
  instructions, `CLAUDE.md` as a symlink to it, and `scripts/link-agents.sh`.
- [pr-self-review.md](./pr-self-review.md) — the `pr-self-review` skill: maps
  the local diff to project skills, blocks push / PR on a confirmed CRITICAL.
- [skills.md](./skills.md) — reusable text-only skills: CRUD + versions + stats,
  binding to agents (order, per-agent enabled), import, prompt slot, trace.
- [conventions.md](./conventions.md) — Conventions Extractor: code-only
  sampling, one structured LLM call, a code evidence gate, accept / reject /
  edit triage, and a `repo-conventions` skill linked to an agent.
- [intent-layer.md](./intent-layer.md) — Intent Layer: a cheap model derives a
  PR's intent/scope from title, body, references and hunk headers; stored per
  PR, injected into the review prompt, shown on the Overview tab.
- [blast-radius.md](./blast-radius.md) — Blast Radius: `GET /pulls/:id/blast` over the
  repo-intel index (no LLM), the facade fixes (per-symbol cap, honest `degraded`/`reason`),
  the Overview card with Tree / Graph views and Resync, and the real MCP `get_blast_radius`.
- [project-context.md](./project-context.md) — SPEC-01 (approved) Project Context: read-only reader of
  repo `.md` docs, manual attach to agents/skills by path, untrusted `## Project context` block within
  a 12k-token budget, per-doc trace (`specs_read`, status, tokens). AC-1 and AC-3 superseded by
  [SPEC-02](../server/specs/project-context-insights.md) (`INSIGHTS.md` files as `insights` documents).

## Repo-wide checks

`./scripts/check-shared.sh` (vendored contracts in sync) and
`./scripts/link-agents.sh --check` (symlinks) run in CI as `repo-checks.yml`.