# Security & data-integrity hardening (wave 0)

Status: implemented (2026-10-12).

Findings from the 2026-10-12 skill-driven audit (`security`,
`fastify-best-practices`, `onion-architecture`) that can lose data, leak a
secret or touch files outside the clone dir. No DB schema or migration change —
the database is explicitly out of scope for this work.

## Decisions

### Clone URLs (X1, X2)

- `GITHUB_URL_REGEX` is anchored to the two accepted forms
  (`https://github.com/<owner>/<repo>` and `git@github.com:<owner>/<repo>`),
  owner/repo are restricted to GitHub's character set, `.`/`..` are rejected,
  and repo names may now contain dots (`vercel/next.js` was rejected before).
- `RepoService.add()` enqueues the canonical `https://github.com/<owner>/<repo>.git`
  rebuilt from the parsed parts, exactly like `refresh()` already did — the raw
  user string never reaches `git clone` (no `file://`, no foreign host).
- `SimpleGitClient.clonePathFor` asserts the resolved path stays inside
  `cloneDir` — defence in depth for the one place that runs `rm -rf`.

### GitHub token never written to disk (X3)

The token used to be embedded into the clone URL, and git persists the remote
URL in `<clone>/.git/config` in plain text. It is now passed per command as
`-c http.extraHeader=Authorization: Basic …` (the clone URL stays clean), and
`fetch`/`sync` reuse the same header from `SimpleGitClient`'s token callback.
Error text persisted by `JobRunner` is scrubbed of `user:pass@` credentials.

**Rejected — `GIT_ASKPASS` helper script:** needs a temp executable file per
process and differs on Windows; `http.extraHeader` is a plain git option.

### API binds to loopback by default (F1)

The API has no auth (`LocalNoAuthProvider`), so `0.0.0.0` let anyone on the LAN
set keys and spend LLM budget. New env `API_HOST`, default `127.0.0.1`.
**Rejected — keep `0.0.0.0` and add auth:** auth is a future course lesson.

### Error and log hygiene (F2, F3)

- 5xx responses send a generic message; the real error is only logged. 4xx
  (Fastify's own 400/404/413/429) keep their message.
- pino `redact` covers auth headers and token/key-shaped fields.

### Test-then-save for BYO keys (S6)

`POST /settings/test-connection` used to persist the key before testing it,
so a typo overwrote a working key. Now the candidate key is tested first and
saved only on success.

### Transactions (S1)

`run-executor` persists review + findings + `last_reviewed_sha` + the `done`
run status in one `db.transaction` (`ReviewRepository.persistCompletedRun`).
Before, a failure between the writes left findings attached to a run marked
`failed`. Repository functions keep `db` as first argument; it now accepts the
transaction executor too (`Executor` in `db/client.ts`).

### Smaller items

- ripgrep pattern passed as `-e <p> --` (X4); `readClone` refuses symlinks and
  paths escaping the clone (X5).
- PR title/author go into the prompt inside `wrapUntrusted('pr-title', …)` (L1);
  `wrapUntrusted` neutralises any case/spacing variant of `<untrusted>` /
  `</untrusted>` (L2). **Rejected — wrapping agent skills as untrusted (L3):**
  skills are the agent's own rules; marking them as data would make the model
  ignore them.
- Grounding iterates over the hunk line set, not the model-supplied range (R2),
  so `end_line: 1e9` can't stall the run. **Rejected — adding `.max()` to the
  `Finding` contract:** it changes the structured-output schema sent to the
  provider and both vendored copies, for a problem the loop fix already removes.

## Acceptance criteria

- `POST /repos` with `https://x.io/github.com/../foo` → 400; with
  `https://github.com/vercel/next.js` → accepted as `vercel/next.js`.
- After a clone with a token set, `<clone>/.git/config` contains no token.
- `pnpm typecheck`, unit, integration (`.it.test`) and `pnpm arch:check` pass.

## Out of scope

DB schema, migrations, indexes, `docker-compose.yml`.
