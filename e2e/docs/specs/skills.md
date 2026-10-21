# e2e: Skills Lab

Flow: [`specs/08-skills.flow.json`](../../specs/08-skills.flow.json). Parent feature
spec: [../../../specs/skills.md](../../../specs/skills.md).

## What it proves (read-only — the flow-contract forbids writing seeded data)

1. The sidebar has the **SKILLS LAB** section and `/skills` renders the empty
   detail pane ("Select a skill") — the seed ships no skills.
2. **Add Skill** is one button (no menu) that opens the **Add skill** modal on `/skills` (no separate route).
3. The modal has three tabs: *Create* (the default: directive hint under *Description*, markdown *Skill body*), *From file* (the drop zone) and *Import from URL* (the URL field, fetched server-side).
4. The two new seeded agents (**Test Quality Reviewer**, **API Contract Reviewer**) exist.
5. An agent's editor has a **Skills** tab (`?tab=skills`).

## What it deliberately does not do

Create / edit / import / bind — those write data. A URL import would also need
the network. They are covered by `server/test/skills.it.test.ts` +
`skills-import.test.ts` + `skills-scan.test.ts` + `safe-fetch.test.ts` (API,
versions, import safety, URL import + SSRF guard, prompt-injection scan, prompt
placement, trace, stats) and by the client component tests (`ConfigTab`,
`AddSkillModal` and its tabs, `SkillScanBanner`, `SkillsTab`, `VersionsTab`). The manual
end-to-end path with a real model is [docs/skills-experiment.md](../../../docs/skills-experiment.md).
