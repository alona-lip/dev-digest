# e2e: Conventions

Flow: [`specs/09-conventions.flow.json`](../../specs/09-conventions.flow.json). Parent feature
spec: [../../../specs/conventions.md](../../../specs/conventions.md).

## What it proves (read-only — the flow-contract forbids writing seeded data)

1. The sidebar's **SKILLS LAB** section has a **Conventions** entry, and it opens
   `/repos/<id>/conventions` for the active repo (criterion 44).
2. The page is titled for the repo ("Conventions in payments-api") under the
   *Skills Lab › Conventions* breadcrumb.
3. A repo with no candidates shows the empty state with **Run Scan** — the first-scan
   button; **Re-scan** only appears once there are candidates (criterion 45).
4. **Run Scan** on the seeded repo — which has no clone — is refused with "The repo is
   not cloned yet". The server returns 422 *before* reading files or calling a model,
   so the flow stays key-free and writes nothing.

## What it deliberately does not do

A real scan, accept / reject / edit, and Create skill — those need a cloned repo and
a model call, and they write data. They are covered by
`server/test/conventions.it.test.ts` (scan → evidence gate → persistence, re-scan
keeps decisions, inline edit, bulk reject, draft, save v1/v2 + additive agent link),
`server/test/conventions-helpers.test.ts` (the gate itself) and the client component
tests (`ConventionCard`, `ConventionsView`, `SkillDraftForm`, `hooks/conventions`).
The manual path with a real model is in the parent spec's *Verification* section.
