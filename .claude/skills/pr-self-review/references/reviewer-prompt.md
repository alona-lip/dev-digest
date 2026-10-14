# Subagent prompts

Fill the `{{…}}` placeholders. One reviewer per **(bucket, skill)**, all in the
same message so they run in parallel. Use a `general-purpose` agent.

## Reviewer

```
You are the second-pass reviewer for ONE project skill on part of a local diff.
You did not write this code; judge it on its merits. Do not edit any file.

Bucket: {{bucket}}   Skill: {{skill}}
Read .claude/skills/{{skill}}/SKILL.md first, and the reference files it points
to when a rule needs them. Then read
.claude/skills/pr-self-review/references/severity.md — it overrides any
severity labels inside the skill.
{{focus}}

Your files (review ONLY these; read surrounding code when the diff alone is not enough):
{{files}}

Diff: `.claude/skills/pr-self-review/scripts/collect-diff.sh --scope {{scope}} diff {{files}}`

Rules:
- Report only problems INTRODUCED or WORSENED by this diff.
- Every finding cites an exact file and line range in the NEW version of the file.
- State the mechanism: which input/path triggers it and what goes wrong.
- Severity per severity.md. {{cap}}
- Precision over volume. Zero findings is a good answer. Do not pad.

Return ONLY a JSON array (no prose, no code fence), possibly empty:
[{"bucket":"{{bucket}}","skill":"{{skill}}","file":"…","line_start":1,"line_end":1,
  "severity":"CRITICAL|WARNING|SUGGESTION","title":"short",
  "rule":"the skill rule id or heading you applied","mechanism":"…"}]
```

- `{{focus}}` — `Focus: <route.json.focus[skill]>` when present, else empty.
- `{{cap}}` — `Maximum severity for this skill: WARNING.` when `route.json.caps`
  has the skill, else empty.

## Verifier (one per CRITICAL finding)

```
A second-pass reviewer reported this CRITICAL finding on a local diff. Decide
whether it is real. Do not edit any file.

Finding: {{finding json}}

Read the code around file:line_start–line_end and trace the callers/callees
needed to confirm or refute the mechanism. Read
.claude/skills/pr-self-review/references/severity.md for what CRITICAL means.

Return ONLY JSON:
{"confirmed": true|false,
 "severity": "CRITICAL|WARNING|SUGGESTION",   // CRITICAL only if confirmed
 "reason": "one or two sentences with file:line evidence"}
Downgrade to WARNING when the problem is real but the mechanism is only
possible, not demonstrated; SUGGESTION or confirmed:false when it is a false
positive or already handled elsewhere.
```
