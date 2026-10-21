# Conventions: PENDING status, rejected candidates hidden

Status: implemented (2026-10-21).

The Conventions Extractor used to start every new candidate as `ACCEPTED`, and
`GET /repos/:id/conventions` returned every status. That broke two parts of the
triage flow:

- **"Create skill" appeared right after a scan**, before the user had accepted
  anything, because the button only waits for one `ACCEPTED` candidate.
- **A rejected candidate came back after a reload**, shown dimmed, so rejecting
  did not remove it from the list.

## Contract

- `ConventionStatus = PENDING | ACCEPTED | REJECTED` (`vendor/shared/contracts/knowledge.ts`,
  mirrored in `client/src/vendor/shared`). The column default is now `PENDING`. This is a new
  migration from `pnpm db:generate`. Existing rows keep their status.
- `GET /repos/:id/conventions` (and the list that `extract` / bulk `PATCH` return)
  leaves out `REJECTED`. The bulk `PATCH` still accepts `REJECTED`.
- The dedupe in `extract` still compares against **all** rows, rejected ones too,
  so a re-scan never brings a rejected rule back as a new candidate.
- The skill draft and save read only `ACCEPTED`, as before.
- Client: a card starts neutral (pending), and Accept / Reject decide its fate. A
  rejected card leaves the list at once (optimistic) and does not come back on
  reload. "Deselect all" sets the accepted cards back to `PENDING`.

## Rejected alternative

**Hide `REJECTED` only on the client and keep the API returning every status.**
Rejected because the server would still hand the rejected rows back, so every
client would need the same filter. It also leaves "a rejected candidate does not
come back after reload" true only for one UI. The list is filtered in the
repository (`listOpen`), next to `listAccepted`.

**Hide rejected rows behind a "Show rejected" toggle.** Rejected for now: once a
rule is rejected there is nothing left to do with it. Un-rejecting can be added
later as a filter on the same endpoint.
