# Sources — key points

Numbered `#1`–`#26`; `SKILL.md` and the other reference files cite these
numbers. ✅ = fetched and read while researching (2026-10-12); every link
returned HTTP 200 on that date. The plain link list is in [../README.md](../README.md#sources).

Contents: [A. Onion & siblings](#a-onion-and-sibling-architectures) ·
[B. Core and boundaries](#b-designing-the-core-and-its-boundaries) ·
[C. TypeScript / Node](#c-typescript--nodejs) · [D. Our tools](#d-our-tools) ·
[E. Enforcement](#e-enforcement) · [Where sources disagree](#where-the-sources-disagree-and-what-we-chose)

---

## A. Onion and sibling architectures

### #1 Jeffrey Palermo — The Onion Architecture: part 1 ✅
https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/ · 2008-07-29
- Coined the name. Fundamental rule: code may depend on more central layers, never on outer ones — "all coupling is toward the center".
- The domain model is the centre and is coupled only to itself.
- Interfaces (e.g. repositories) live in the application core; implementations live at the edge and are injected at runtime.
- "The database is not the center. It is external."
- Aimed at long-lived business apps with complex behaviour, not small websites.

### #2 Alistair Cockburn — Hexagonal (Ports & Adapters) Architecture ✅
https://alistair.cockburn.us/hexagonal-architecture/ · 2005
- A port is "a purposeful conversation" with the outside, organised by purpose, not technology.
- Several adapters can plug into one port: SQL, flat file, in-memory mock.
- Primary (driving) side: UI, tests, other programs start the conversation. Secondary (driven) side: DB, notifications — the app calls them.
- Goal: run the application "without either a UI or a database", fully isolated, for automated regression tests.

### #3 Robert C. Martin — The Clean Architecture ✅
https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html · 2012
- The Dependency Rule: "Source code dependencies can only point inwards."
- Nothing named in an outer circle may be mentioned by an inner one, including framework-generated data formats.
- "Isolated, simple, data structures are passed across the boundaries" — don't "cheat and pass Entities or Database rows".
- Data crossing a boundary takes the shape most convenient for the inner circle.

### #4 Mark Seemann — Layers, Onions, Ports, Adapters: it's all the same ✅
https://blog.ploeh.dk/2013/12/03/layers-onions-ports-adapters-its-all-the-same/ · 2013
- Apply the Dependency Inversion Principle to a layered architecture and you get Ports & Adapters — onion, hexagon and clean are the same idea.
- UI and data access must not depend on each other.
- "The flatter the dependency hierarchy, the better."

### #5 Herberto Graça — Explicit Architecture ✅
https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/ · 2017, upd. 2020
- Ports belong inside the core; adapters outside. Primary adapters wrap a port and call the core; secondary adapters implement a port the core needs.
- Ports should "fit the Application Core needs" rather than mimic a tool's API.
- Application services: load entities via repositories, tell them to act, persist. Domain services: logic spanning entities.
- Package by component; components don't reference each other's code ("not even interfaces"); shared kernel "as minimal as possible".
- A component changes only the data it owns.

### #6 Microsoft Learn — Common web application architectures ✅
https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures
- Hexagonal, Ports-and-Adapters, Onion and Clean are names for the same DIP + DDD-driven architecture.
- Application Core holds entities, interfaces, domain services; Infrastructure implements the interfaces (repositories, external services); UI talks to the core through interfaces.
- The composition root (startup) wires implementations to interfaces; limit references to infrastructure types to it.
- Core is unit-tested in isolation; infrastructure is integration-tested against real dependencies.

### #7 Martin Fowler — Presentation Domain Data Layering ✅
https://martinfowler.com/bliki/PresentationDomainDataLayering.html · 2015
- Presentation / domain / data access; main benefit is a reduced scope of attention, plus testability via seams.
- A mapper lets the domain not depend on its data source (hexagonal).
- As apps grow, "split your top level into domain oriented modules which are internally layered" — exactly our `modules/<name>/` + role files.

## B. Designing the core and its boundaries

### #8 Mark Seemann — What's a sandwich? ✅
https://blog.ploeh.dk/2023/10/09/whats-a-sandwich/ · 2023
- The impureim sandwich: at each entry point, do the impure reads, call a pure function, then do the impure writes.
- Functional core, imperative shell: decisions are pure and testable; I/O is pushed to the edges.
- Seemann concedes it doesn't cover every case (e.g. a later query depending on an earlier result) — then split into several sandwiches.

### #9 Gary Bernhardt — Boundaries ✅
https://www.destroyallsoftware.com/talks/boundaries · SCNA 2012
- Simple values as the boundaries between components and subsystems.
- A functional core with an imperative shell makes isolated unit testing natural.

### #10 Martin Fowler — Repository (PoEAA) ✅
https://martinfowler.com/eaaCatalog/repository.html
- Mediates between the domain and data mapping layers with a "collection-like interface for accessing domain objects".

### #11 Martin Fowler — Anemic Domain Model ✅
https://martinfowler.com/bliki/AnemicDomainModel.html · 2003
- Objects that look like a domain model but carry no behaviour, with logic in procedural services, are an anti-pattern: "If all your logic is in services, you've robbed yourself blind."

### #12 Mark Seemann — Service Locator is an Anti-Pattern ✅
https://blog.ploeh.dk/2010/02/03/ServiceLocatorisanAnti-Pattern/ · 2010
- A service locator "hides a class' dependencies, causing run-time errors instead of compile-time errors".
- Use constructor injection; wire the object graph in a single composition root.

### #13 Alexis King — Parse, don't validate ✅
https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/ · 2019
- Turn less-structured input into a more precise type at the boundary instead of checking and discarding what you learned.
- "Make illegal states unrepresentable"; let types carry the proof inward.

## C. TypeScript / Node.js

### #14 Sairyss — Domain-Driven Hexagon ✅
https://github.com/Sairyss/domain-driven-hexagon
- TypeScript reference: modules by business capability; application services per use case; ports in the core, implemented in infrastructure.
- Keep persistence models separate from domain shapes; mappers in repositories.
- Don't over-abstract — depending on a concrete class is sometimes fine.
- Expected errors as results mapped to HTTP in controllers; keep HTTP concerns out of the core. Ships a dependency-cruiser config.

### #15 Khalil Stemmler — Organizing App Logic with the Clean Architecture ✅
https://khalilstemmler.com/articles/software-design-architecture/organizing-app-logic/ · 2019
- Six kinds of logic: presentation, data access/adapter, application (use cases), domain service, validation, core entity.
- Adapters at the edges (controllers, repositories, payment SDKs); use cases as commands/queries.
- Layering pays off for long-lived apps with many rules; small apps may not need it.

### #16 Remo H. Jansen — Implementing the Onion Architecture in Node.js with TypeScript and InversifyJS ✅
https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad · 2018
- Domain with repository interfaces; infrastructure with controllers, ORM repositories and data mappers.
- Wiring via an IoC container (InversifyJS). Comments note the style can feel over-abstracted — weigh against project size.

## D. Our tools

### #17 Fastify — Encapsulation ✅
https://fastify.dev/docs/latest/Reference/Encapsulation/
- Each plugin is a context that inherits only from its parents; decorators/hooks don't leak to siblings.
- `fastify-plugin` breaks encapsulation for the wrapped plugin only.

### #18 Fastify — Decorators ✅
https://fastify.dev/docs/latest/Reference/Decorators/
- `decorate` is synchronous; async setup goes through `register`.
- `decorateRequest`/`decorateReply` reject reference types (shared state across requests); use `onRequest` or getters.

### #19 Fastify — Testing guide ✅
https://fastify.dev/docs/latest/Guides/Testing/
- Separate the app builder from `listen()`; test with `inject()`, which boots plugins without a port; close the app after tests.

### #20 fastify-type-provider-zod ✅
https://github.com/turkerdev/fastify-type-provider-zod
- Register `validatorCompiler`/`serializerCompiler`; call `withTypeProvider<ZodTypeProvider>()` so params/body/response types infer from Zod; response schemas keyed by status code.

### #21 @fastify/awilix ✅ (considered, rejected)
https://github.com/fastify/fastify-awilix
- DI for Fastify via awilix: app-scoped `diContainer`, request-scoped `request.diScope`, SINGLETON/SCOPED lifetimes.
- Rejected for DevDigest: duplicates the existing hand-written container + `ContainerOverrides`.

### #22 Drizzle — Transactions ✅
https://orm.drizzle.team/docs/transactions
- `db.transaction(async (tx) => …)`; nested `tx.transaction` uses savepoints; `tx.rollback()` throws to abort; the callback's return value is returned; Postgres options `isolationLevel`, `accessMode`, `deferrable`.

### #23 Drizzle — Type API (goodies) ✅
https://orm.drizzle.team/docs/goodies
- `typeof table.$inferSelect` / `$inferInsert` (or `InferSelectModel`/`InferInsertModel`) give row types — persistence types, kept in ring 3a / `db/rows.ts`.

## E. Enforcement

### #24 dependency-cruiser — Rules reference ✅
https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md
- `forbidden` / `allowed` / `required` rules with `from`/`to` regex `path`/`pathNot`; `$1` group matching for "no sibling imports"; `dependencyTypes` (`type-only`, `core`, `npm`…); severity `error` fails the build.

### #25 lastminute.com — How we enforce architecture boundaries at scale ✅
https://technology.lastminute.com/how-we-enforce-architecture-boundaries-at-scale-on-our-app/ · 2026
- dependency-cruiser in CI fails the build on forbidden dependencies; rules rolled out module by module rather than big-bang.

### #26 dependency-cruiser — CLI ✅
https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md
- `--ignore-known` reads `.dependency-cruiser-known-violations.json` and downgrades those to `ignore`; `-T baseline` / `--baseline` writes it.
- `err-long` prints each rule's `comment`; exit code = number of errors.

---

## Where the sources disagree, and what we chose

| Question | Positions | DevDigest choice |
|---|---|---|
| Rich entities vs. functions over data | #11 calls logic-in-services an anti-pattern; #8, #9 put rules in pure functions over plain values | **Functional core.** Contracts are Zod data; rules live in pure helpers. The anti-pattern we police is rules *outside pure functions* (in routes, SQL, services). |
| Interface for every repository? | #1, #6, #16 put repository interfaces in the core; #14 warns against over-abstraction | **No.** Ports only for external systems (LLM, GitHub, git, embeddings, secrets). Repositories are concrete, integration-tested against real Postgres. |
| DI framework vs. hand-written container | #16 (Inversify), #21 (awilix) | **Hand-written** `Container` + `ContainerOverrides`, already the backbone of the test suite. |
| Explicit layer folders vs. role-named files | #14, #16 use `domain/`, `application/`, `infrastructure/` folders; #7 suggests domain modules internally layered | **Role-named files** inside domain modules (`routes`/`service`/`repository`/`helpers`) — the file role *is* the ring. |
| Can row types cross inward? | #3: never pass database rows inward | **As types only, via `db/rows.ts`**, consumed by `toXDto` mappers — a pragmatic seam that avoids a parallel domain-entity hierarchy. Value imports of the schema stay forbidden. |
| Exceptions vs. Result objects | #14 prefers `Result` for expected errors | **Exceptions** (`AppError` subclasses) mapped once in `app.ts` — consistent with the existing code; a Result type would be a codebase-wide change. |
