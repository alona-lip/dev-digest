# Skill examples

Ready-to-use skill texts for the control experiment ([../skills-experiment.md](../skills-experiment.md)).
`pnpm db:seed` creates all of them from these files and binds them, switched on and
in the order below, to their agents
([../../server/specs/seed-skill-bindings.md](../../server/specs/seed-skill-bindings.md)).
The seed reads the files directly, so an edit here takes effect on the next clean seed.
A skill that already exists is never overwritten.

To go through the UI path by hand (create / import → preview → save → bind → run → trace),
first delete the seeded skill: the import preview flags a name that is already taken.

| File | Agent | How to add it by hand |
|---|---|---|
| `test-quality/branch-coverage.md` | Test Quality Reviewer | Skills → Add Skill → **Import from file** |
| `test-quality/corner-cases.md` | Test Quality Reviewer | Add Skill → **Create skill**, paste the body |
| `test-quality/test-smells/` | Test Quality Reviewer | `zip -r test-smells.zip test-smells` → **Import from file** (the zip carries a script that must show as *ignored*) |
| `api-contract/breaking-change.md` | API Contract Reviewer | Import from file |
| `api-contract/response-schema.md` | API Contract Reviewer | Create skill, paste the body |
| `api-contract/deprecation-policy.md` | API Contract Reviewer | Create skill, paste the body |
| `api-contract/semver-discipline.md` | API Contract Reviewer | Import from file |

Each `.md` has frontmatter (`name`, `description`, `type`) that the importer reads.
The description is written as a directive — *when to apply the skill and what to do* —
because it is the skill's interface. Each API Contract skill ends with a **Bad / Good**
example and maps its findings onto the agent's `CRITICAL / WARNING / SUGGESTION` scale.

The seed binds the API Contract skills in this order on the agent's **Skills** tab:
`breaking-change` → `response-schema` → `deprecation-policy` → `semver-discipline`
(what breaks first, then the policy around it). The order is the prompt order.

The four replace the earlier `route-breaking-change` + `contract-compat` pair. Keeping
those as well was rejected. They overlap the new four (a route rename hits three of them),
so the agent would report the same issue twice, and Skills → Stats could no longer
tell which skill produced a finding.

> A skill is configuration text placed in the agent's system prompt. Read an
> imported one before you save it: foreign skill = foreign instructions.
