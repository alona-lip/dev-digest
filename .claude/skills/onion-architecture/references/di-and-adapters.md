# DI container, ports, adapters — and testing per ring

## Ports live in the core, adapters at the edge

All outbound ports are interfaces in `server/src/vendor/shared/adapters.ts`:
`LLMProvider`, `Embedder`, `GitHubClient`, `GitClient`, `CodeIndex`,
`SecretsProvider`, `AuthProvider`. Implementations live in
`src/adapters/<kind>/<impl>.ts` (`OpenAIProvider`, `AnthropicProvider`,
`OctokitGitHubClient`, `SimpleGitClient`, `RipgrepCodeIndex`, …), and
`OpenRouterProvider` lives in `reviewer-core/src/llm/`.

Design a port from the core's side: what does the use case need? "list the PRs
of a repo", "complete with a structured schema" — not "an Octokit instance"
(#5). Several adapters can fit one port (real, mock, in-memory) (#2).

## The composition root

`src/platform/container.ts` is the only place where concrete classes meet the
ports (#6). It:
- holds process-wide things (`config`, `db`, `jobs`, `runBus`);
- builds adapters **lazily**, because most need a secret from `SecretsProvider`
  that may not exist at boot (so `container.llm(id)` and `container.github()`
  are `async`);
- accepts `ContainerOverrides` so tests inject mocks.

`app.ts` attaches the container with `app.decorate('container', …)`;
`modules/index.ts` registers the module plugins. Those three files plus
`server.ts` are the composition root and may import anything.

## Adding an external integration — 4 steps

Example: post a summary to Slack after a review.

1. **Port** in `vendor/shared/adapters.ts`:
   `export interface Notifier { notify(msg: ReviewNotice): Promise<void> }`
   — `ReviewNotice` is a plain contract, not a Slack payload.
2. **Adapter** `src/adapters/notifier/slack.ts` implementing it with the SDK or
   `fetch`; the SDK import is legal only here (rule `sdk-only-in-adapters`).
   Map SDK errors to `ExternalServiceError`.
3. **Wire** in `container.ts` — lazily if it needs `SLACK_TOKEN` from
   `SecretsProvider`; secrets never go into `AppConfig`.
4. **Override** — add `notifier?: Notifier` to `ContainerOverrides` and a mock
   in `src/adapters/mocks.ts`. Skipping this step is the common mistake: the
   code works and every test now calls Slack.

The service then depends on `Notifier`, never on `SlackNotifier`.

## How services get their dependencies

Today most services take the whole container:

```ts
// existing (baselined pattern) — Service Locator
export class AgentsService {
  private repo: AgentsRepository;
  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
  }
  async models(provider: Provider) {
    const llm = await this.container.llm(provider);   // hidden dependency
  }
}
```

The dependencies are invisible in the signature and only fail at runtime when a
mock is missing (#12). For **new** services, inject what you use:

```ts
// new code — constructor injection of narrow collaborators
export class NotificationsService {
  constructor(
    private readonly repo: ReviewRepository,
    private readonly notifier: () => Promise<Notifier>,  // lazy port, secret resolved on first use
  ) {}
}

// routes.ts (driving adapter) or container.ts builds it
const service = new NotificationsService(app.container.reviewRepo, () => app.container.notifier());
```

When you touch an existing service anyway, prefer moving it toward this shape
rather than adding another `this.container.x` call. Don't introduce a DI
framework (`@fastify/awilix`, InversifyJS) — the hand-written container plus
`ContainerOverrides` already does the job and the whole test suite depends on
it (#21, #16).

## Adapters stay dumb

- An adapter translates; it doesn't decide. No business rules, no workspace
  logic, no imports from `src/modules/**` (rule `adapters-dont-know-modules`).
  Constants an adapter needs (supported extensions, limits) belong to the
  adapter or to `vendor/shared`, not to a feature module.
- Pure parsers that happen to sit in `src/adapters/` (`git/diff-parser.ts`,
  `codeindex/extract.ts`) are reached through the port or moved next to their
  consumer when touched — modules may not import `src/adapters/**`
  (rule `modules-use-ports-not-adapters`).

## Cross-module access

A module never imports another module's internal file (rule
`no-cross-module-internals`). Options, in order of preference:
1. A shared repository exposed by the container (`container.agentsRepo`,
   `container.reviewRepo`) — already the pattern for cross-cutting entities.
2. The other module's `index.ts` facade (`repo-intel/index.ts` → `RepoIntel`
   interface, injected as `container.repoIntel`).
3. Move the shared piece to `modules/_shared/` (presentation helpers) or
   `vendor/shared` (contracts and pure functions everyone needs).

## Testing per ring

| Ring | How | Example |
|---|---|---|
| 0–1 pure | plain unit tests, no mocks, no DB | `test/pulls-status.test.ts`, `test/reviews-helpers.test.ts`, reviewer-core `npm test` |
| 2 application | service/route with fake ports via `ContainerOverrides` (mock LLM, mock GitHub) | `test/routes-smoke.test.ts` |
| 3a repositories | real Postgres via Testcontainers, `*.it.test.ts` | `test/pulls-list.it.test.ts` |
| 3b routes | `buildApp({ overrides })` + `app.inject()` (#19) | `test/routes-smoke.test.ts` |

If a rule is hard to test without a database, it is in the wrong ring — pull
it into a pure helper (#9, #4).
