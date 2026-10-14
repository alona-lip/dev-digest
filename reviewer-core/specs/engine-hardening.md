# Engine hardening (2026-10-12)

Status: implemented (2026-10-12).

Fixes from the skill-driven audit (`onion-architecture` §7, `security`, `zod`)
where the engine trusted model output or diff text more than it should.

## Decisions

- **Prompt injection.** `wrapUntrusted` neutralises every tag that could read
  as our delimiter — opening or closing, any case, spacing — not only the
  exact `</untrusted>`. The server's task line now carries the PR title and
  author inside a `pr-title` block (they were interpolated into the trusted
  sentence). `INJECTION_GUARD` is unchanged (do-not-touch).
- **Grounding cost is bounded by the diff.** `rangeIntersects` walks the hunk
  line set instead of `start_line..end_line`, so `end_line: 1e9` from the
  model costs nothing.
- **`sliceDiff` matches the header's end** (` b/<path>`), not a substring;
  map-reduce skips chunks without a hunk instead of paying an LLM call on an
  empty diff (all skipped → one whole-diff pass).
- **Provider.** `StructuredRequest.timeoutMs` is honoured per request;
  `listModels` has a fetch timeout; provider cost is used only if every repair
  attempt reported one, otherwise the estimate over all tokens (the
  null-poisoning rule in INSIGHTS).
- **Tests live with the engine.** `grounding-gate.test.ts` and
  `prompt-structured.test.ts` moved here from `server/test`.

## Rejected

- **Wrapping agent skills as untrusted** — skills are the agent's own rules;
  as "data" the model would ignore them.
- **`.max()` bounds on `Finding.start_line/end_line`** — changes the
  structured-output schema sent to providers and both vendored contract
  copies; the loop fix removes the actual risk.
- **Truncating the invalid output in the repair loop** — the model needs its
  own previous answer to repair it; the token cost is bounded by `maxRetries`.

## Not done

- Per-slot token budgets (diff, repo map, callers, specs) and splitting one
  huge file — changes what the model sees; needs its own spec and eval run.
- Reporting tokens/cost of a run whose structured output never validated.
