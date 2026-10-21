# Seed: example skills bound to the Test Quality / API Contract reviewers

Status: implemented (2026-10-21).

`seed.ts` creates **Test Quality Reviewer** and **API Contract Reviewer** with
deliberately generic prompts. The skills in `docs/skills-examples/` are what
make them sharp. Until now those skills were created and bound by hand through
the UI, so after a clean seed both agents had no skills.

This reverses the "New agents" row of [../../specs/skills.md](../../specs/skills.md).
The rejected alternative there was "seed the skills, and then nobody uses the
create/import path". The import path is still covered by `test/skills.it.test.ts`
and `test/skills-import.test.ts`, and a person can still try it by hand (see
`docs/skills-examples/README.md`).

## Contract

- `pnpm db:seed` reads the skill files from `docs/skills-examples/`, resolved
  from the `server/` folder (`process.cwd()`, the cwd of `pnpm db:seed` and of
  the tests). `import.meta.url` is not used, because `seed.ts` is also bundled
  into `dist/server.js`, where a path relative to the module points outside
  the repo.
  - Test Quality Reviewer: `branch-coverage` → `corner-cases` → `test-smells`
    (`test-smells/SKILL.md`. The zip's other files are not part of a skill anyway.)
  - API Contract Reviewer: `breaking-change` → `response-schema` →
    `deprecation-policy` → `semver-discipline`
- Each file goes through the importer's own `parseSkillMarkdown` and
  `scanSkillBody` (`modules/skills/helpers.ts`). It is stored through
  `SkillRepository.insert` with `source: 'imported_file'` at v1 plus a
  `skill_versions` snapshot, the same as `SkillsService.create`. A body that
  the scan flags is stored disabled.
- If a skill with that name already exists in the workspace, seed reuses it
  and never overwrites it, so user edits survive a re-seed.
- Only an agent with **no `agent_skills` rows** is touched: its skills are
  created (or reused) and linked in the order above with `enabled: true`. An
  agent that has any link is skipped entirely. Its links are not changed and
  none of its skills are created, so a skill someone deleted does not come back.
- Links are written through `AgentsRepository.replaceSkills`, the same as a
  Skills-tab save. The agent's version is bumped and snapshotted in
  `agent_versions` with the skill ids, so runs before and after the seed never
  share a version.
- A missing skill file makes the seed fail. It does not leave the agents
  empty without saying so.

## Acceptance

- After a clean seed, both agents' Skills tabs show their skills in order,
  all switched on, and a review run's trace has one skill block per skill.
- Running the seed again adds no skills and no links.
- Unbinding a skill and running the seed again does not bring the link back.

## Known limitation

An agent whose skills were **all** unbound has zero links. The seed cannot tell
that apart from "never bound", so the next seed binds the example set again
(`./scripts/dev.sh` seeds by default). Unbinding is a hard delete, and
remembering that an agent was cleared on purpose would need a new column or
table (a migration), which is too much for demo data. To keep an agent without
skills, switch its links off on the Skills tab instead of unbinding them. Found
by `/pr-self-review` (drizzle-orm-patterns), 2026-10-21.

## Rejected alternatives

**Inline copies of the skill texts in a `seed-skills.ts`** (the way
`seed-prompts.ts` mirrors `docs/agent-prompts/`). Rejected: two copies of
seven texts would drift. The texts have already been rewritten once
(`route-breaking-change` + `contract-compat` became four skills).

**Write the links with `onConflictDoNothing` on every seed run.** Rejected: a
re-seed would bring back a skill the user unbound, and the default links would
end up mixed into the user's own order.

**Bound but disabled links** (`agent_skills.enabled = false`). This would keep
the control experiment in `docs/skills-experiment.md` unchanged, but after a
seed the agents would still run without skills, which is the problem this
change fixes. Instead, the experiment's baseline run now starts by switching
the links off on the Skills tab.

## Out of scope

- Seeding skills for the other built-in agents.
- Updating seeded skills when the files in `docs/skills-examples/` change.
  An existing skill is never touched. To pick up a new text, delete the skill
  and re-seed.
