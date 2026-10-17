# Skills prompt slot

Status: in progress (2026-10-16). Parent spec: [../../specs/skills.md](../../specs/skills.md).

## Goal

Agent skills (reusable, text-only configuration) reach the model as separate,
ordered blocks appended to the agent's system prompt, so a trace can show each
block and its token cost.

## Contract

```ts
interface PromptSkill { name: string; body: string }
PromptParts.skills?: PromptSkill[]   // already filtered (enabled) and ordered by the caller
```

System message = `agent prompt` + `## Skills` + one `### Skill: <name>` block per
skill (in order) + `INJECTION_GUARD` (always last). No skills → no `## Skills`
section, output identical to before. The user message no longer carries skills.
`assembly.skills` is the rendered `## Skills` body (blocks only).

`renderSkillBlock(skill)` is exported so the server can count tokens per block
with exactly the text the model sees.

## Decisions

- **System, not user.** Skills are agent configuration, same trust level as the
  system prompt. **Rejected:** keep them in the user message — mixes config with
  PR data and contradicts the editor copy ("skills are appended below it").
- **Not wrapped in `<untrusted>`.** Unchanged from `docs/prompt-assembly.md`:
  wrapping would make the model ignore the rules a skill carries. Trust is decided
  by a human at import preview.
- **Skill name is flattened to one line** so a name cannot inject a heading.
- `INJECTION_GUARD` stays last and untouched.

## Out of scope

Token counting (server owns the tokenizer; this package stays pure), skill
selection/filtering, detector runs.
