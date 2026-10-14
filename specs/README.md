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

## Repo-wide checks

`./scripts/check-shared.sh` (vendored contracts in sync) and
`./scripts/link-agents.sh --check` (symlinks) run in CI as `repo-checks.yml`.
