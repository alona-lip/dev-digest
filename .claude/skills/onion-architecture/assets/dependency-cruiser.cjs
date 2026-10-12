/**
 * Onion-architecture rules for server + reviewer-core.
 *
 * The rules and the reasoning behind each one live in the `onion-architecture`
 * skill (.claude/skills/onion-architecture/). A canonical copy of this file is
 * kept at .claude/skills/onion-architecture/assets/dependency-cruiser.cjs —
 * change both in the same commit.
 *
 * Run: `pnpm arch:check` (fails only on NEW violations; known ones are listed in
 * .dependency-cruiser-known-violations.json and get fixed when the file is touched).
 *
 * Paths are regexes relative to server/: server code is `src/...`, the review
 * engine is `../reviewer-core/src/...`.
 */

/** Third-party SDKs that may only be imported by a driven adapter. */
const SDKS =
  'node_modules/(octokit|@octokit|simple-git|openai|@anthropic-ai|@vscode/ripgrep|@ast-grep|dependency-cruiser|js-tiktoken)/';
const DB_DRIVERS = 'node_modules/(drizzle-orm|postgres)/';
const HTTP_FRAMEWORK = 'node_modules/(fastify|@fastify|fastify-type-provider-zod|fastify-sse-v2)/';

/** Ring 1 — pure domain logic inside a feature module. */
const DOMAIN_FILES = '^src/modules/[^/]+/(helpers|status|constants)\\.ts$';
/** A module's data layer: `repository.ts` or anything under `repository/`. */
const REPOSITORY = '^src/modules/[^/]+/repository(\\.ts$|/)';
const REVIEWER_CORE = '^\\.\\./reviewer-core/src/';

const SKILL = 'See .claude/skills/onion-architecture/SKILL.md';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ---------- ring 0: shared kernel ----------
    {
      name: 'shared-kernel-is-pure',
      severity: 'error',
      comment:
        'src/vendor/shared holds the wire contracts and the adapter ports — the centre of the onion. ' +
        `It may depend on zod and on itself, nothing else. ${SKILL} §2.`,
      from: { path: '^src/vendor/shared/' },
      to: { pathNot: ['^src/vendor/shared/', 'node_modules/zod/'] },
    },

    // ---------- ring 1: domain logic ----------
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment:
        'helpers.ts / status.ts / constants.ts are pure functions over contracts. No DB, no HTTP, no SDK, ' +
        'no platform services (platform/errors.ts — the domain error taxonomy — is the one exception). ' +
        'Move the I/O into service.ts and pass plain values in. ' +
        `Type-only imports of row types (src/db/rows.ts, own repository re-export) are allowed for toXDto mappers. ${SKILL} §3.`,
      from: { path: DOMAIN_FILES },
      to: {
        path: ['^src/(db|adapters|platform)/', REPOSITORY, DB_DRIVERS, HTTP_FRAMEWORK, SDKS],
        pathNot: ['^src/platform/errors\\.ts$'],
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'domain-knows-no-infra-types',
      severity: 'error',
      comment:
        'Even as types, domain files may only see row shapes (src/db/rows.ts or the own repository re-export), ' +
        `never Drizzle tables, adapters, HTTP types or the Container. ${SKILL} §3.`,
      from: { path: DOMAIN_FILES },
      to: {
        path: ['^src/(db|adapters|platform)/', DB_DRIVERS, HTTP_FRAMEWORK, SDKS],
        pathNot: ['^src/db/rows\\.ts$', '^src/platform/errors\\.ts$'],
        dependencyTypes: ['type-only'],
      },
    },

    // ---------- ring 2: application ----------
    {
      name: 'db-only-in-repositories',
      severity: 'error',
      comment:
        'Drizzle, the postgres driver and the table objects in src/db/schema* belong to repository/*.repo.ts. ' +
        'Add a repository method and call it from the service. ' +
        `Type-only imports of src/db/rows.ts are fine. ${SKILL} §6.`,
      from: { path: '^src/modules/', pathNot: REPOSITORY },
      to: {
        path: ['^src/db/', DB_DRIVERS],
        pathNot: ['^src/db/rows\\.ts$'],
      },
    },
    {
      name: 'application-knows-no-http',
      severity: 'error',
      comment:
        'Only routes.ts (and the request-context helper) speak Fastify. Services return DTOs and throw AppError; ' +
        `the error handler in app.ts maps them to HTTP. ${SKILL} §4.`,
      from: {
        path: '^src/modules/',
        pathNot: [
          'routes\\.ts$',
          '^src/modules/index\\.ts$',
          '^src/modules/[^/]+/index\\.ts$',
          '^src/modules/_shared/context\\.ts$',
        ],
      },
      to: { path: [HTTP_FRAMEWORK, 'routes\\.ts$'] },
    },

    // ---------- ring 3b: presentation ----------
    {
      name: 'routes-are-thin',
      severity: 'error',
      comment:
        'routes.ts = parse (zod schema) → call the service → return the DTO. No SQL, no repositories, no adapters. ' +
        `${SKILL} §4.`,
      from: { path: 'routes\\.ts$' },
      to: { path: ['^src/db/', '^src/adapters/', REPOSITORY, DB_DRIVERS, SDKS] },
    },

    // ---------- ring 3a: driven adapters ----------
    {
      name: 'sdk-only-in-adapters',
      severity: 'error',
      comment:
        'Every third-party SDK sits behind a port from src/vendor/shared/adapters.ts and is implemented in ' +
        `src/adapters/<kind>/. Construct it in platform/container.ts. ${SKILL} §7.`,
      from: {
        pathNot: ['^src/adapters/', '^src/platform/container\\.ts$', `${REVIEWER_CORE}llm/`],
      },
      to: { path: SDKS },
    },
    {
      name: 'modules-use-ports-not-adapters',
      severity: 'error',
      comment:
        'Modules reach an adapter through the Container (typed by its port), never by importing src/adapters/*. ' +
        `${SKILL} §7.`,
      from: { path: '^src/modules/' },
      to: { path: '^src/adapters/' },
    },
    {
      name: 'adapters-dont-know-modules',
      severity: 'error',
      comment: `An adapter implements a port; it must not call feature modules. ${SKILL} §7.`,
      from: { path: '^src/adapters/' },
      to: { path: '^src/modules/' },
    },

    // ---------- module boundaries ----------
    {
      name: 'no-cross-module-internals',
      severity: 'error',
      comment:
        "A module may not import another module's files. Go through the Container (container.agentsRepo, " +
        `container.repoIntel), the module's index.ts facade, or move the shared piece to modules/_shared. ${SKILL} §9.`,
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/',
        pathNot: ['^src/modules/($1|_shared)/', '^src/modules/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'only-composition-root-wires-modules',
      severity: 'error',
      comment:
        'platform/ is cross-cutting infrastructure. Only platform/container.ts (the composition root) may know ' +
        `concrete module classes. ${SKILL} §2.`,
      from: { path: '^src/platform/', pathNot: '^src/platform/container\\.ts$' },
      to: { path: '^src/modules/' },
    },

    // ---------- reviewer-core: the pure engine ----------
    {
      name: 'reviewer-core-is-pure',
      severity: 'error',
      comment:
        'reviewer-core has no DB, GitHub, FS or HTTP server. Its only side effect is the injected LLMProvider. ' +
        `${SKILL} §8.`,
      from: { path: REVIEWER_CORE },
      to: {
        path: ['^src/', DB_DRIVERS, HTTP_FRAMEWORK, 'node_modules/(octokit|@octokit|simple-git)/'],
        // @devdigest/shared resolves to server/src/vendor/shared — the shared kernel, allowed.
        pathNot: ['^src/vendor/shared/'],
      },
    },
    {
      name: 'reviewer-core-no-node-io',
      severity: 'error',
      comment: `reviewer-core must stay runnable in CI and tests without touching disk, processes or the network directly. ${SKILL} §8.`,
      from: { path: REVIEWER_CORE },
      to: {
        dependencyTypes: ['core'],
        path: '^(node:)?(fs|fs/promises|child_process|net|http|https|dgram|cluster|worker_threads)$',
      },
    },
    {
      name: 'reviewer-core-sdk-only-in-llm',
      severity: 'error',
      comment:
        'Only reviewer-core/src/llm/ (the LLMProvider adapter + its structured-output helper) may import the openai SDK. ' +
        `${SKILL} §8.`,
      from: { path: REVIEWER_CORE, pathNot: `${REVIEWER_CORE}llm/` },
      to: { path: 'node_modules/openai/' },
    },
    {
      name: 'reviewer-core-via-public-api',
      severity: 'error',
      comment: `server imports @devdigest/reviewer-core (src/index.ts), never a deep path. ${SKILL} §8.`,
      from: { path: '^src/' },
      to: { path: REVIEWER_CORE, pathNot: `${REVIEWER_CORE}index\\.ts$` },
    },

    // ---------- hygiene ----------
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular imports usually mean two rings were merged. Type-only cycles are ignored (they vanish at runtime). ' +
        `${SKILL} §11.`,
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'The import does not resolve — a typo, a missing install, or a path alias the config does not know.',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Keep `import type` edges: a type-only import of a Drizzle table is still a leak.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
      extensions: ['.ts', '.js', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
