# Frontend UI Architecture Skill — References and Sources

Sources for the `frontend-ui-architecture` skill: where code lives in a React /
Next.js App Router frontend, how components are split, where constants, helpers,
utils and business logic go, and how module boundaries are enforced.
**Architecture only. Performance is out of scope.**

Sources are numbered `#1`–`#25`; `SKILL.md` cites these numbers. Status:
✅ = fetched and read while researching (2026-10), ⚠️ = could not be fetched
(listed for context, not as a primary source).

Skill questions each source answers:
**A** where things live · **B** splitting components · **C** business logic /
hooks / state / data layer · **D** utils, helpers, constants, abstractions ·
**E** enforcing boundaries.

---

## A. Where files and components live (folder structure, colocation)

### #1 Next.js — Project structure and organization ✅
- **URL**: https://nextjs.org/docs/app/getting-started/project-structure
- **Author / date**: Vercel, Next.js docs v16.3, last updated 2026-07-21
- **Answers**: A
- A folder in `app/` becomes a route only once it has `page` or `route`; other files can be colocated there safely
- `_folder` (private folder) opts a folder and its subfolders out of routing. Recommended for "separating UI logic from routing logic"
- `(group)` folders organize routes without changing the URL; `src/` keeps app code apart from config
- Three strategies: keep code outside `app/`, use top-level folders inside `app/`, or split by feature/route. "Choose a strategy that works for you and your team and be consistent"

### #2 React (legacy docs) — FAQ: File Structure ✅
- **URL**: https://legacy.reactjs.org/docs/faq-structure.html
- **Author / date**: React team (legacy docs)
- **Answers**: A
- Two common approaches: group by feature/route, or group by file type
- "Consider limiting yourself to a maximum of three or four nested folders"
- "Don't spend more than five minutes on choosing a file structure"
- "Keep files that often change together close to each other" (colocation)

### #3 Kent C. Dodds — Colocation ✅
- **URL**: https://kentcdodds.com/blog/colocation
- **Author / date**: Kent C. Dodds, 2019-06-17
- **Answers**: A, D
- Core rule: **"Place code as close to where it's relevant as possible"**
- Tests, styles, state and comments live next to the code they describe
- Central `utils/` folders collect orphaned, unmaintained code; keep utilities near where they're used

### #4 bulletproof-react — Project Structure ✅
- **URL**: https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
- **Author / date**: Alan Alickovic (alan2207), maintained repo
- **Answers**: A, E
- `src/{app, assets, components, config, features, hooks, lib, stores, testing, types, utils}`
- Each `features/<name>/` contains only what it needs from `api/ components/ hooks/ stores/ types/ utils/`
- No cross-feature imports; compose features at the app level instead
- One-way flow **shared → features → app**, enforced with ESLint `import/no-restricted-paths`
- Now recommends direct imports over barrel files (tree-shaking/perf issues)

### #5 Robin Wieruch — React Folder Structure in 7 Steps ✅
- **URL**: https://www.robinwieruch.de/react-folder-structure/
- **Author / date**: Robin Wieruch, updated 2026-05-05
- **Answers**: A, D
- How a structure grows: single file → files → component folders → technical folders → feature folders → domain folders → packages/monorepo
- **"If exactly one feature uses a util, it lives inside that feature"**; promote to shared only when two or more features need it
- Barrel files are acceptable only when they re-export the module's public API, not everything
- Boundaries: shared → features → pages; features don't import from each other

### #6 Josh W. Comeau — Delightful React File/Directory Structure ✅ *(counterpoint)*
- **URL**: https://www.joshwcomeau.com/react/file-structure/
- **Author / date**: Josh W. Comeau
- **Answers**: A, D
- Organizes **by function** (components, hooks, helpers) rather than by feature; argues feature boundaries shift over time
- Component folder: `FileViewer.tsx`, `FileViewer.helpers.ts`, `FileViewer.types.ts`, `index.ts`, plus subcomponents
- Global `src/hooks/`, `src/helpers/` (project-specific), `src/utils.ts` (generic, portable), `src/constants.ts`
- Defends `index.ts` files: perf cost is negligible for most web apps

### #7 Alex Kondov — Tao of React ✅
- **URL**: https://alexkondov.com/tao-of-react/
- **Author / date**: Alex Kondov
- **Answers**: A, B, D
- "Group by Route/Module"; "Create a Common Module" for shared UI
- "Use Absolute Paths"; "Wrap External Components" behind your own adapter
- "Move Components in Folders" with their styles/tests
- Helpers that need no closure live outside the component, above it; "Avoid Nested Render Functions" — extract a component instead

### #8 Feature-Sliced Design — Overview ✅
- **URL**: https://feature-sliced.design/docs/get-started/overview
- **Author / date**: FSD community methodology
- **Answers**: A, E
- Layers (top → bottom): app → pages → widgets → features → entities → shared
- Slices split a layer by business domain; slices on the same layer can't import each other
- Segments by purpose: `ui`, `api`, `model` (schemas, stores, business logic), `lib`, `config`
- Import rule: "Modules on one layer can only know about and import from modules from the layers strictly below"

### #9 Feature-Sliced Design — Usage with Next.js ✅
- **URL**: https://feature-sliced.design/docs/guides/tech/with-nextjs
- **Author / date**: FSD community
- **Answers**: A, C
- Next.js `app/` is for routing only and re-exports pages from FSD layers in `src/` (`_app`, `_pages` renamed to avoid clashes)
- Separate `index.server.ts` public API for server-only modules so server code can't leak into the client module graph

---

## B. How to split components

### #10 react.dev — Thinking in React ✅
- **URL**: https://react.dev/learn/thinking-in-react
- **Author / date**: React team
- **Answers**: B, C
- "A component should ideally only be concerned with one thing. If it ends up growing, it should be decomposed into smaller subcomponents"
- Component hierarchy follows the data model: well-structured JSON maps to the UI structure
- Build the static version first, then find the minimal state; put state in the closest common parent

### #11 patterns.dev — Container/Presentational Pattern ✅
- **URL**: https://www.patterns.dev/react/presentational-container-pattern/
- **Author / date**: Lydia Hallie, Addy Osmani
- **Answers**: B, C
- Classic split: containers fetch data and hold logic; presentational components render props
- Hooks have largely replaced container components as the way to separate logic from view
- Related pages: Hooks, Compound, Render Props, React Server Components patterns

### #12 Dan Abramov — Presentational and Container Components ⚠️
- **URL**: https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0
- **Author / date**: Dan Abramov, 2015 (2019 update)
- **Answers**: B
- Historical source of the container/presentational split
- The author's 2019 update says he no longer recommends splitting components this way; hooks replace it
- Not fetched (Medium returns 403 to the fetcher). Use for history only; cite #11 and #15 for the rule

### #13 Juntao Qiu (martinfowler.com) — Headless Component ✅
- **URL**: https://martinfowler.com/articles/headless-component.html
- **Author / date**: Juntao Qiu, 2023-11-07
- **Answers**: B, C
- A headless component "extracts all non-visual logic and state management, separating the brain of a component from its looks"
- Usually implemented as a custom hook that returns state, handlers and ARIA props
- Use it when the same behaviour must drive several visual variants, or when logic should be tested without the UI

---

## C. Business logic, hooks, state, data layer

### #14 Juntao Qiu (martinfowler.com) — Modularizing React Applications with Established UI Patterns ✅
- **URL**: https://martinfowler.com/articles/modularizing-react-apps.html
- **Author / date**: Juntao Qiu, 2023-02-16
- **Answers**: C (main source for "where business logic lives")
- Three layers: **presentation** (components), **domain** (models, strategies, pure business rules), **data** (network access)
- Step by step: extract a hook from the view → extract domain objects → replace scattered conditionals with a strategy
- The network layer acts as an anti-corruption layer between API shapes and domain logic
- Benefits: a change touches one place (no "shotgun surgery"); domain logic is testable without React

### #15 react.dev — Reusing Logic with Custom Hooks ✅
- **URL**: https://react.dev/learn/reusing-logic-with-custom-hooks
- **Author / date**: React team
- **Answers**: C, D
- "Custom Hooks let you share stateful logic but not state itself"
- Use the `use` prefix only if the function calls hooks; otherwise write a plain function (a helper)
- Avoid lifecycle wrappers (`useMount`, `useEffectOnce`); hooks should name concrete use cases (`useOnlineStatus`, `useChatRoom`)
- "You don't need to extract a custom Hook for every little duplicated bit of code. Some duplication is fine"

### #16 react.dev — Choosing the State Structure ✅
- **URL**: https://react.dev/learn/choosing-the-state-structure
- **Author / date**: React team
- **Answers**: C
- Five principles: group related state; avoid contradictions (one `status` instead of several booleans); avoid redundant state (derive it); avoid duplication (store an id, not a copy); avoid deep nesting (normalize)

### #17 Kent C. Dodds — Application State Management with React ✅
- **URL**: https://kentcdodds.com/blog/application-state-management-with-react
- **Author / date**: Kent C. Dodds, 2020-07-21
- **Answers**: C
- Server cache and UI state are different kinds of state; use a server-cache library (react-query) for the first
- Colocate state; lift it only to the closest common parent
- "Don't reach for context too soon"; prefer several focused providers over one global store

### #18 TkDodo — Effective React Query Keys ✅
- **URL**: https://tkdodo.eu/blog/effective-react-query-keys
- **Author / date**: Dominik Dorfmeister (TanStack Query maintainer)
- **Answers**: C, A
- "I keep my Query Keys next to their respective queries, co-located in a feature directory" (`features/Todos/queries.ts`)
- Export only the custom hooks; query functions and keys stay module-private
- Query-key factories (`todoKeys.all / lists() / list(filters) / detail(id)`) allow invalidation at any level

### #19 Next.js — How to think about data security ✅
- **URL**: https://nextjs.org/docs/app/guides/data-security
- **Author / date**: Vercel, Next.js docs v16.3, last updated 2026-08-25
- **Answers**: C
- Three data approaches: **External HTTP APIs** (existing backends), **Data Access Layer** (new projects), component-level access (prototypes only). "Choose one data fetching approach and avoid mixing them"
- A DAL runs server-only, checks authorization, and returns minimal DTOs; only the DAL reads `process.env`
- `"use server"` actions stay thin and delegate auth and DB work to the `server-only` DAL
- Client Component props should accept only the fields they render, not whole records

### #20 Next.js — Server and Client Components ✅
- **URL**: https://nextjs.org/docs/app/getting-started/server-and-client-components
- **Author / date**: Vercel, Next.js docs v16.3, last updated 2026-08-25
- **Answers**: C, A
- `"use client"` marks a module-graph boundary: everything it imports becomes client code
- Put `"use client"` on specific interactive leaves, not on large subtrees
- Interleave by passing Server Components to Client Components as `children`/props
- Render context providers as deep as possible; wrap client-only third-party components in your own `"use client"` file
- `server-only` / `client-only` imports turn a wrong-environment import into a build error

---

## D. Utils, helpers, constants, abstractions

### #21 Kent C. Dodds — AHA Programming ✅
- **URL**: https://kentcdodds.com/blog/aha-programming
- **Author / date**: Kent C. Dodds, 2020-06-22
- **Answers**: D
- Avoid Hasty Abstractions: tolerate duplication until the shared pattern is obvious
- "Optimize for change first"; early abstractions grow conditionals for every new caller

### #22 Sandi Metz — The Wrong Abstraction ✅
- **URL**: https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction
- **Author / date**: Sandi Metz, 2016-01-20
- **Answers**: D
- "Duplication is far cheaper than the wrong abstraction"
- To recover: inline the abstraction back into each caller, delete the branches each caller doesn't need, then re-abstract from what's left

### #23 TypeScript Handbook — Enums: Objects vs Enums ✅
- **URL**: https://www.typescriptlang.org/docs/handbook/enums.html
- **Author / date**: TypeScript team
- **Answers**: D
- "In modern TypeScript, you may not need an enum when an object with `as const` could suffice"
- Pattern: `const X = { ... } as const` plus `type X = typeof X[keyof typeof X]`
- Rationale: it "keeps your codebase aligned with the state of JavaScript"

### #24 TkDodo — Please Stop Using Barrel Files ✅
- **URL**: https://tkdodo.eu/blog/please-stop-using-barrel-files
- **Author / date**: Dominik Dorfmeister, 2024-07-26
- **Answers**: D, E
- Barrels don't make anything private: "there isn't anything that would force other developers to only import from the barrels"
- Modules inside a folder that import from their own barrel create circular imports
- Real Next.js case: removing internal barrels cut loaded modules from 11k to 3.5k
- Use direct imports in app code; reserve barrels for library entry points

---

## E. Enforcing the boundaries

### #25 eslint-plugin-boundaries ✅
- **URL**: https://github.com/javierbrea/eslint-plugin-boundaries
- **Author / date**: Javier Brea, maintained repo
- **Answers**: E
- Classifies files into element types (e.g. app, feature, shared) by path pattern
- Declares which element types may import which; violations fail lint
- Can restrict entry points and external dependencies per element type
- Lighter alternative: `import/no-restricted-paths`, as in bulletproof-react (#4)

---

## Where sources disagree → resolution for the skill

| Question | Disagreement | Resolution |
|---|---|---|
| Group by feature or by type? | #6 groups by type; #3, #4, #5, #8 group by feature; #1 and #2 say pick one | **Hybrid.** Shared code grouped by type (`src/components/`, `src/lib/`); feature code colocated with the route in `_components/` |
| Barrel / `index.ts` files | #4 and #24 are against; #5 and #6 allow them | A component's `index.ts` may re-export that one component. A folder-wide `export *` barrel is allowed only as a deliberate, small public API (DevDigest's `src/lib/hooks/index.ts`) and is never imported from inside its own folder. No new barrels by default |
| Container / Presentational | #12 is the origin; #11 and #12's own update now prefer hooks | Put logic in custom hooks / headless hooks (#13, #15), not wrapper container components |
| When to extract a helper/util | #3 and #21 (keep local, wait) vs DRY | Start local. Promote to shared only at 2+ consumers (#5) **and** once the pattern is obvious (#21, #22) |
| Where business logic goes | #14 (domain layer) vs "just put it in hooks" | Pure rules and calculations are plain functions (`helpers.ts`, testable without React); hooks only orchestrate state and data (#14, #15) |

---

## DevDigest context

So the skill codifies the repo's existing conventions instead of contradicting them:

- `client/AGENTS.md` and the root `AGENTS.md` already set:
  - route-local feature code in `_components/<Name>/` with `<Name>.tsx`, `<Name>.test.tsx`, and `styles.ts` / `helpers.ts` / `constants.ts` / `index.ts` as needed (this is #1's private folders plus #3's colocation)
  - cross-route components in `src/components/<kebab-name>/`
  - hooks grouped by domain in `src/lib/hooks/<domain>.ts`, not one file per hook
  - data only through TanStack Query hooks in `src/lib/hooks/*` → `src/lib/api.ts`; never `fetch` in components (#17, #18)
  - `src/lib/hooks/index.ts` is a deliberate `export *` barrel over the domain files, and `client/docs/data-flow.md` says components import from it. That's why the barrel rule above is "deliberate public API only", not "never"
  - nested private sub-components (`AgentEditor/_components/ConfigTab/`) and a logic-free `atoms.tsx` (`RunTraceDrawer/_components/atoms.tsx`) are existing patterns
  - thin route entries already exist (`app/agents/page.tsx` renders `<AgentsListView />`); some older pages are `"use client"` and hold more logic
  - `src/vendor/shared` and `src/vendor/ui` are vendored copies, never edited by hand
- The client calls a separate Fastify API, which is #19's "External HTTP APIs" approach. Next.js DAL and Server Actions guidance (#19, #20) is background for this repo, not a rule to apply.
- Neighbouring skills to link instead of repeating: `react-best-practices` (anti-patterns, state rules) and `next-best-practices` (routing file conventions, RSC boundaries).
