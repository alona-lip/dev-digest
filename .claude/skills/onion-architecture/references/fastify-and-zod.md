# Fastify + Zod — the driving side (ring 3b)

`routes.ts` is a *driving adapter*: it translates HTTP into a call on the
application ring and translates the result back (#2, #5). Everything it knows
about HTTP stays here; nothing it knows about storage is allowed here.

## The shape of a handler

```ts
// GOOD — modules/agents/routes.ts (simplified)
export default async function agentsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new AgentsService(app.container);          // see di-and-adapters.md

  app.post('/agents', { schema: { body: CreateAgentBody } }, async (req) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    return service.create(workspaceId, req.body, userId);     // one call, DTO out
  });
}
```

```ts
// BAD — modules/pulls/routes.ts today (baselined): SQL, GitHub sync and
// rollup logic inline in the handler
app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req) => {
  const [repo] = await container.db.select().from(t.repos).where(/* … */);
  const gh = await container.github();
  for (const pr of await gh.listPullRequests(/* … */)) {
    await container.db.insert(t.pullRequests).values(/* … */);
  }
  // … 150 more lines of queries and grouping
});
```

Why the first is better: the use case ("list PRs, syncing from GitHub when
possible") can be tested with a mock `GitHubClient` and no HTTP; the handler is
obviously correct by reading it; the next lesson's module can reuse the
service.

**Moving logic out of a fat handler** (when you're already changing it):
1. Create/extend `service.ts` with a method named after the use case.
2. Move each query into a `repository/<entity>.repo.ts` function taking `db`.
3. Move pure decisions (grouping, "latest", null-vs-zero) into `helpers.ts` /
   `status.ts` with unit tests.
4. Leave the handler as context → service → return.
5. Run `pnpm arch:check`; then `pnpm arch:baseline` and confirm the baseline
   diff only removes entries.

## Rules

- **Schema-first validation.** Put Zod schemas on `schema.params`, `body`,
  `querystring` (and `response` where the DTO is stable). With
  `validatorCompiler`/`serializerCompiler` registered in `app.ts`, the handler
  receives typed, already-parsed data — "parse, don't validate" at the edge
  (#13, #20). Don't call `Schema.parse(req.body)` in the handler and don't
  re-validate in the service.
- **Wire contracts live in `vendor/shared/contracts`**, in `snake_case`
  (`cost_usd`). Request-only schemas that no other package needs may live at the
  top of `routes.ts` (as `CreateAgentBody` does). The `snake_case` → `camelCase`
  mapping is explicit at the boundary; never rename a wire field to match TS.
- **Contracts are data.** A Zod schema in `vendor/shared` must not import
  anything but `zod` (rule `shared-kernel-is-pure`). Behaviour over contracts
  goes in helpers.
- **Every contract change is applied to both copies** —
  `server/src/vendor/shared` and `client/src/vendor/shared` — in the same commit
  (server INSIGHTS, 2026-09-20).
- **Errors.** Services throw `AppError` subclasses (`NotFoundError`,
  `ValidationError`, `ExternalServiceError`, `ConfigError`) from
  `platform/errors.ts`. The one `setErrorHandler` in `app.ts` turns them, Zod
  validation errors and serialization failures into the `ApiErrorBody`
  envelope. A service never calls `reply.status()` and never imports Fastify
  (rule `application-knows-no-http`).
- **Request context.** Tenancy comes from `getContext(container, req)`
  (`modules/_shared/context.ts`) and is passed to the service as plain
  `workspaceId`/`userId` strings — the service never sees `FastifyRequest`.
- **Encapsulation.** Each module is a plugin registered in `modules/index.ts`;
  hooks/decorators it adds stay inside its context. Wrap with `fastify-plugin`
  only something every module needs (auth, a shared hook) (#17). The only
  instance decorator is `container` (#18).
- **SSE.** Progress streaming goes through `platform/sse.ts` (`runBus`). The
  executor publishes events to the bus; the route subscribes and writes to the
  stream. The executor doesn't know a stream exists.
- **Testing.** `buildApp({ config, overrides })` + `app.inject()` — no port,
  plugins booted, adapters mocked through `ContainerOverrides` (#19). See
  `server/test/routes-smoke.test.ts`.

## Not statically enforced — catch in review

- `container.db` used in a route or service without importing Drizzle (e.g.
  only through `container.db.query.*`).
- A handler with branching business logic but no forbidden import.
- A service method that takes `FastifyRequest`-shaped objects typed as `any`.
