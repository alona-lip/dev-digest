# e2e: Skills Lab

Flow: [`specs/08-skills.flow.json`](../../specs/08-skills.flow.json). Parent feature
spec: [../../../specs/skills.md](../../../specs/skills.md).

## What it proves (read-only — the flow-contract forbids writing seeded data)

1. The sidebar has the **SKILLS LAB** section and `/skills` renders the empty
   detail pane ("Select a skill") — the seed ships no skills.
2. **Add Skill** offers **Create skill** and **Import from file**.
3. *Create skill* opens a modal on `/skills` (no separate route) with the directive hint under *Description* and the markdown *Skill body* field.
4. The two new seeded agents (**Test Quality Reviewer**, **API Contract Reviewer**) exist.
5. An agent's editor has a **Skills** tab (`?tab=skills`).

## What it deliberately does not do

Create / edit / import / bind — those write data. They are covered by
`server/test/skills.it.test.ts` + `skills-import.test.ts` (API, versions, import
safety, prompt placement, trace, stats) and by the client component tests
(`ConfigTab`, `ImportSkillModal`, `SkillsTab`, `VersionsTab`). The manual
end-to-end path with a real model is [docs/skills-experiment.md](../../../docs/skills-experiment.md).
