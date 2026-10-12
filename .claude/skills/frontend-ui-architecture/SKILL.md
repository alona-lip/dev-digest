---
name: frontend-ui-architecture
description: "Frontend UI architecture and code organization for React and Next.js App Router apps: where components, constants, helpers, utils, hooks and business logic live; how to split a component into files and sub-components; which folders may import which; where the Server/Client boundary goes. Use this skill whenever you create a new component, page, feature or hook, move or refactor code between files, answer where-should-this-live questions (util or helper? hook or function? is this business logic?), set up or review a frontend folder structure, or review a PR for structure and placement, even if the user never says architecture. Use it for any new file under client/src. Not for render performance or hooks anti-patterns (use react-best-practices) and not for Next.js routing file conventions or data-fetching APIs (use next-best-practices)."
metadata:
  version: 1.0.0
  updated: 2026-10-11
  tags: react, nextjs, app-router, architecture, folder-structure, colocation, frontend
---

# Frontend UI Architecture

Where code lives in a React + Next.js (App Router) frontend, and why. Each rule
cites a source `#N` from [references.md](references.md). Open the matching entry
there when you need the reasoning, or when you have to justify a decision in a
review.

**Scope: placement and organization only.** Two neighbouring skills cover the rest:
- render/state anti-patterns, misuse of hooks, performance → `react-best-practices`
- routing special files (`page`, `layout`, `loading`, …), RSC data APIs, metadata → `next-best-practices`

**Working in DevDigest (`client/`)?** Read [§10](#10-devdigest-client--overrides)
first. Repo conventions override the generic defaults below.

## How to use this skill

- **Placing new code:** find the row in the §2 decision table, then follow the
  file-role rules in §3–§5.
- **Refactoring:** decide which layer each piece belongs to (§6) and move it
  there. Don't introduce layers the code doesn't need yet.
- **Reviewing:** run the §9 checklist. Each finding names the rule and the source.
- **Conflicts with existing code:** if a rule here conflicts with how the
  surrounding code already works, follow the surrounding code and point out the
  inconsistency. Two conventions mixed in one area is worse than either one
  alone (#1, #2).

---

## 1. Principles

1. **Colocate.** Put code as close as possible to where it's used. Tests, styles,
   constants, helpers, sub-components and state live next to their only consumer
   (#3, #2). Things that change together stay together. Deleting a feature should
   mean deleting a folder.
2. **Promote, don't predict.** New code starts local. Move it somewhere shared only
   when a second consumer actually exists (#5) and the shared shape is obvious
   (#21). A wrong shared abstraction costs more than duplication (#22). If a shared
   helper keeps growing a flag per caller, inline it back into the callers.
3. **Dependencies point one way: shared → features → app/routes** (#4, #8). Shared
   code never imports from a feature, and features don't import each other. The
   route composes them.
4. **Separate deciding from rendering.** Components render, hooks orchestrate, pure
   functions decide, and the data layer talks to the network (#14).
5. **Consistency beats the ideal layout.** Next.js is deliberately unopinionated, so
   pick one strategy and apply it everywhere (#1). Don't over-plan the structure up
   front, and keep nesting to about 3–4 levels (#2).

## 2. Where things live

A reference layout for Next.js App Router, using the "split by feature/route"
strategy from #1:

```
src/
├── app/                               routing + route-local code
│   ├── layout.tsx, page.tsx           thin: read params, compose feature components
│   └── <route>/
│       ├── page.tsx                   e.g. `return <AgentsListView />`
│       ├── constants.ts, helpers.ts   shared by several components of THIS route only
│       └── _components/               private folder, never routable (#1)
│           └── <Name>/
│               ├── <Name>.tsx
│               ├── <Name>.test.tsx
│               ├── index.ts           re-exports <Name>: the component's public entry
│               ├── constants.ts  helpers.ts  styles.ts  types.ts   (only when needed)
│               └── _components/       sub-components private to <Name>
├── components/<kebab-name>/           UI used by 2+ routes (same inner layout)
└── lib/
    ├── api.ts                         the only module that calls fetch (HTTP client)
    ├── hooks/<domain>.ts              data hooks grouped by domain (queries + mutations)
    └── <topic>.ts                     domain-agnostic utilities, providers, config
```

**Decision table: "I'm adding…"**

| What | Where | Why |
|---|---|---|
| Component used by one route | `app/<route>/_components/<Name>/` | colocation; private folder (#1, #3) |
| Sub-component used only inside `<Name>` | `<Name>/_components/<Sub>/` | the parent's folder stays the unit of change |
| Several tiny, logic-free pieces of one parent | one `atoms.tsx` next to them | a folder for each would be noise |
| Component used by 2+ routes | `src/components/<kebab-name>/` | promoted when the 2nd consumer appeared (#5) |
| Constant or lookup table for one component | `<Name>/constants.ts` | §4 |
| Pure function for one component | `<Name>/helpers.ts` | §5 |
| Pure function shared by components of one route | `app/<route>/helpers.ts` | narrowest common parent |
| Domain-agnostic utility used in 2+ places | `src/lib/<topic>.ts` | §5 |
| Server data (query or mutation) | `src/lib/hooks/<domain>.ts`, built on `src/lib/api.ts` | one data path (#17, #18) |
| Hook that is one component's UI behaviour | next to it: `<Name>/use<Thing>.ts` or `<Name>/hooks/` | colocation (#3) |
| Types for one component | inline, or `<Name>/types.ts` if several files share them | API shapes come from the contract module, never redefined |
| Third-party component that needs client features or an adapter | thin wrapper in `src/components/` | one place to adapt it (#7, #20) |

Larger apps can replace `app/<route>/_components` with
`src/features/<feature>/{components,hooks,api,utils}` (#4) or with FSD layers
(#8, #9), and keep `app/` for routing only. That pays off when features are reused
across many routes. Whichever you choose, don't run both styles in one codebase.

## 3. Splitting components

**Split a component when** (#10, #7):
- it handles more than one concern (a list *and* its filter bar *and* a modal);
- you catch yourself writing a nested render function (`renderRow()`). Make it a component instead;
- one part has its own state or effects that the rest doesn't care about;
- one part would be reused, or deserves its own test.

Don't split just to hit a line count. A 150-line component with one job is fine.
Split along the data: well-shaped data usually maps onto the component tree (#10).

**Every file role in a component folder has exactly one home**, so readers know
where to look:

| File | Contains | Does not contain |
|---|---|---|
| `<Name>.tsx` | the component: hook calls, event wiring, JSX | top-level lookup tables, reusable pure logic |
| `constants.ts` | named values, lookup maps, thresholds, key bindings | functions with logic, UI text |
| `helpers.ts` | pure functions: data in → data out | React imports, hooks, side effects |
| `styles.ts` | style objects / class maps | logic |
| `types.ts` | types shared by several files in this folder | wire/API types (import those) |
| `index.ts` | a single re-export of the component | anything else |
| `<Name>.test.tsx` | tests for this component | — |

Create a role file only when you have something to put in it.

**Logic that several visual variants share** belongs in a *headless* hook (#13).
The hook owns the state, handlers and ARIA props, and each variant renders its own
markup. Container/presentational wrapper components are no longer the default way
to separate logic from view; use a custom hook instead (#11, #12).

## 4. Constants

- **Name every value that encodes a decision**: thresholds, limits, ordering, key
  bindings, polling intervals. Put it in the nearest `constants.ts`. Literals that
  explain themselves (`gap: 8`) stay inline.
- **Use an `as const` object plus a derived union instead of `enum`** (#23). It
  stays plain JavaScript and narrows exactly:
  ```ts
  export const RUN_STATUS = { RUNNING: "running", DONE: "done", FAILED: "failed" } as const;
  export type RunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS];
  ```
- **Key lookup tables by the real union**, e.g. `Record<Severity, number>` rather
  than `Record<string, number>`. Then adding a new member is a compile error, not a
  silent gap.
- **Import contract values; don't copy them.** Enums and field names that come from
  the API contract are imported from the contract module, never redefined locally.
- **UI text goes in i18n messages, not constants.** Environment-dependent values
  are read in one config module, not scattered across constants.
- **Scope grows only on demand:** component → route → `src/lib/<topic>.ts`. Promote
  a constant when its second consumer appears (#5).

## 5. Helpers, utils, hooks: which one?

| The code… | It is a… | It lives in |
|---|---|---|
| is pure and knows this feature's domain (`countBySeverity(findings)`) | helper | `helpers.ts` next to its consumer |
| is pure and knows nothing about the domain (`formatBytes`, `clamp`) | util | the local `helpers.ts` first; `src/lib/<topic>.ts` once 2+ places use it |
| calls React hooks (state, effects, query hooks, context) | hook, named `use…` | next to its consumer, or `lib/hooks/<domain>.ts` for data hooks |
| calls no hooks | **not** a hook, so no `use` prefix (#15) | `helpers.ts` |

- **Keep helpers outside the component body**, and pass them only what they need
  (#7). That's what lets you test them without rendering anything.
- **Name a hook after a concrete use case** (`useFindingAction`, `useOnlineStatus`),
  not after a lifecycle step (`useMount`, `useEffectOnce`) (#15).
- **No catch-all `utils.ts`** that collects unrelated functions from all over the
  app. That's where orphaned code goes to hide (#3). Group shared utilities by topic
  (`lib/github-urls.ts`, `lib/model-label.ts`).
- **Tolerate small duplication** until the pattern is obvious (#21). "Some
  duplication is fine" (#15).

## 6. Business logic

Think in four layers. Each layer knows only the one directly below it (#14):

| Layer | Responsibility | Where |
|---|---|---|
| View | render, turn events into calls | `<Name>.tsx` |
| Orchestration | combine data with UI state, trigger actions | custom hooks |
| Domain | rules, calculations, validation, derived values | pure functions in `helpers.ts` or a domain module; framework-free |
| Data access | network, caching, error normalization, API shape | `lib/api.ts` + query hooks (client); a `server-only` DAL (server) |

- **Write business rules as pure functions with no React import.** This covers
  filtering, scoring, totals and display-level permissions. They become
  unit-testable and callable from a hook, a Server Component or a test alike (#14).
- **Components never call `fetch` or the API client directly.** Data goes through
  one data layer, so caching, error handling and invalidation stay consistent
  (#17, #18). Keep query keys and query functions private to the data module and
  export only the hooks (#18).
- **Server cache and UI state are different things.** The query library owns server
  cache; components own UI state. Don't copy server data into `useState` (#17).
  Keep state minimal (#16); `react-best-practices` has the details.
- **Centralize repeated conditionals.** If the same check on one concept
  (`if (kind === "x")`) shows up in several components, move it into one domain
  function or a strategy map (#14).
- **Next.js with server-side data:** put database and secret access in a
  `server-only` Data Access Layer. It checks authorization and returns minimal DTOs.
  `"use server"` actions stay thin and delegate to it. Pick one data approach for
  the whole app and don't mix approaches (#19).

## 7. The Server/Client boundary (as structure, not performance)

- **`"use client"` marks a module-graph boundary**: everything that file imports
  becomes client code (#20). Put it on the interactive leaf (`LikeButton`,
  `SearchBox`), not on a page or a layout.
- **Server-rendered content inside a client wrapper** (modal, tabs) is passed as
  `children` or props, not imported into the wrapper (#20).
- **Context providers** are client components that take `children`. Mount them as
  deep as their consumers allow (#20).
- **Mark environment-specific modules.** Modules with secrets or DB access get
  `import "server-only"`; browser-only modules get `import "client-only"`. Then an
  import from the wrong side fails the build instead of leaking (#20, #9).
- **Give Client Components only the fields they render**, never whole records (#19).

## 8. Imports and boundaries

- **No cross-feature imports.** If route A needs something from route B's
  `_components`, that thing is shared: promote it to `src/components/` or `lib/`
  first (#4, #5).
- **Direction:** `app/` → `components/` → `lib/`, never backwards. A shared
  component must not import from `app/` (#4, #8).
- **Use the `@/` alias for anything outside the current component folder**, and
  relative `./` imports only inside it. Long `../../../../` chains break when files
  move and hide the dependency direction (#7).
- **Barrels:**
  - A component's `index.ts` that re-exports that one component is fine.
  - A folder-wide `export *` barrel is OK only as a deliberate, small public API,
    such as a data-hooks module.
  - Never import a barrel from inside the folder it re-exports; that creates cycles.
  - Don't add new barrels by default (#24, #4, #5).
- **Enforce the boundaries with lint** once the team has agreed on them:
  `eslint-plugin-boundaries` or `import/no-restricted-paths` (#25, #4).

## 9. Review checklist

- [ ] New code sits next to its only consumer, and nothing with a single consumer was promoted to shared (§1, §2)
- [ ] `page.tsx` / `layout.tsx` stay thin: params plus composition
- [ ] The component folder uses role files (`constants` / `helpers` / `styles` / `index`); lookup tables and pure logic aren't inline in the `.tsx` (§3)
- [ ] Pure logic has no React import, and functions that call no hooks don't start with `use` (§5)
- [ ] No `fetch` or API-client calls in components; data comes through data-layer hooks (§6)
- [ ] Constants use `as const` + a union, typed keys, and contract enums are imported, not redefined (§4)
- [ ] No imports from another route's `_components`, and no shared → app imports (§8)
- [ ] `"use client"` sits on leaves, and server-only code is marked (§7)
- [ ] Cross-folder imports use `@/`; no new folder-wide barrels (§8)
- [ ] Structure matches the neighbouring code, or the deviation is intentional and explained

## 10. DevDigest (`client/`): overrides

Repo conventions beat the generic defaults above. The sources of truth are
`client/AGENTS.md`, `client/docs/data-flow.md` and the naming conventions in the
root `AGENTS.md`.

- **Stack:** Next.js 15 App Router, React 19, TanStack Query, next-intl. The
  backend is a separate Fastify API, so the app uses #19's "external HTTP API"
  approach. There's no DAL and no Server Actions.
- **Thin route entries:** `app/agents/page.tsx` just renders `<AgentsListView />`
  from `_components`. Copy that pattern for new routes. Some older pages are
  `"use client"` and hold more logic; don't copy those.
- **Route-local components:** `src/app/**/_components/<Name>/` with `<Name>.tsx`,
  `<Name>.test.tsx`, plus `constants.ts` / `helpers.ts` / `styles.ts` / `index.ts`
  as needed. Reference example:
  `app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/`.
- **Nested private sub-components** look like `AgentEditor/_components/ConfigTab/`.
  Logic-free layout pieces are grouped in an `atoms.tsx`
  (`RunTraceDrawer/_components/atoms.tsx`).
- **`styles.ts`** exports `export const s = { … } satisfies CSSProperties` per key,
  and components use `style={s.x}`.
- **`index.ts`** is one line: `export { Name, Name as default } from "./Name";`.
- **Shared components** live in `src/components/<kebab-name>/` (`severity`,
  `diff-viewer`, `app-shell`, the last one with its own `hooks/`).
- **Data path:** `src/lib/api.ts` (the only `fetch`; normalizes errors into
  `ApiError`) → `src/lib/hooks/<domain>.ts` (`core`, `reviews`, `agents`, `trace`,
  `repo-intel`) → components. There's never one file per hook. A new data hook goes
  into the matching domain file; a new domain gets a new file plus a line in
  `lib/hooks/index.ts`.
- **`src/lib/hooks/index.ts` is the deliberate barrel exception** from §8. Import
  from `@/lib/hooks` or `@/lib/hooks/<domain>`, not via a `../../../../lib/hooks`
  relative chain.
- **Wire types and enums** (`Severity`, `FindingRecord`, …) come from
  `@devdigest/shared` (`src/vendor/shared`). DTO fields stay `snake_case` all the way
  into JSX. Never edit `src/vendor/*` by hand.
- **UI text** lives in `messages/en/<namespace>.json`; keys are camelCase, dotted by
  surface.
- **Tests** are colocated `*.test.tsx` files. The check gate is `pnpm typecheck` +
  `pnpm test`.

## Sources

[references.md](references.md) lists all 25 sources with their key points and
explains where they disagree and why we resolved it this way.
[README.md](README.md) has the version history and the plain link list.
