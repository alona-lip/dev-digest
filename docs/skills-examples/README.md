# Skill examples

Ready-to-use skill texts for the control experiment ([../skills-experiment.md](../skills-experiment.md)).
They are **not seeded** — create or import them through the UI so the whole path
(create / import → preview → save → bind to an agent → run → trace) is exercised.

| File | Agent | How to add it |
|---|---|---|
| `test-quality/branch-coverage.md` | Test Quality Reviewer | Skills → Add Skill → **Import from file** |
| `test-quality/corner-cases.md` | Test Quality Reviewer | Add Skill → **Create skill**, paste the body |
| `test-quality/test-smells/` | Test Quality Reviewer | `zip -r test-smells.zip test-smells` → **Import from file** (the zip carries a script that must show as *ignored*) |
| `api-contract/route-breaking-change.md` | API Contract Reviewer | Import from file |
| `api-contract/contract-compat.md` | API Contract Reviewer | Create skill, paste the body |

Each `.md` has frontmatter (`name`, `description`, `type`) that the importer reads.
The description is written as a directive — *when to apply the skill and what to do* —
because it is the skill's interface.

> A skill is configuration text placed in the agent's system prompt. Read an
> imported one before you save it: foreign skill = foreign instructions.
