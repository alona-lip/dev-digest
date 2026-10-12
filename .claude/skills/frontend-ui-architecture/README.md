# frontend-ui-architecture

**Version:** 1.0.0 · **Updated:** 2026-10-11 · **Scope:** Frontend (React + Next.js App Router)

A skill that tells the agent **where frontend code belongs and why**:
- where components, constants, helpers, utils, hooks and business logic go
- how to split a component into files and sub-components
- which folders may import which
- where the Server/Client boundary sits

It covers architecture and code organization only. It deliberately leaves out
performance and React anti-patterns.

## When it triggers

- creating a new component, page, feature or hook
- moving or refactoring code between files
- "where should this live?" questions: util or helper, hook or function, is this business logic
- setting up or reviewing a frontend folder structure
- reviewing a PR for structure and placement
- any new file under `client/src`

## How it relates to the other frontend skills

| Need | Skill |
|---|---|
| Where code lives, how it's split, import boundaries | **frontend-ui-architecture** (this one) |
| Render/state anti-patterns, hooks misuse, performance | [react-best-practices](../react-best-practices/SKILL.md) |
| Routing special files, RSC data APIs, metadata, images/fonts | [next-best-practices](../next-best-practices/SKILL.md) |
| Component and hook tests | [react-testing-library](../react-testing-library/SKILL.md) |

## Files

| File | For | Contents |
|---|---|---|
| [SKILL.md](SKILL.md) | the agent | Rules in 10 sections; each rule cites a source `#N`. §10 lists the DevDigest-specific overrides |
| [references.md](references.md) | agent + people | Key points from each of the 25 sources, where the sources disagree and how we resolved it, DevDigest context |
| README.md | people | This overview, the version history and the link list |
| `evals/evals.json` | maintainers | Test prompts and assertions used to check the skill (skill-creator format; not loaded by the agent) |

## Versioning

The version lives in `SKILL.md` frontmatter under `metadata.version`. The skill
spec allows only `name`, `description`, `license`, `allowed-tools`, `metadata` and
`compatibility` at the top level. It follows semver:
- **major:** a rule changes so that existing code would now be flagged
- **minor:** new rules or sections
- **patch:** wording, examples, links

Bump the version in `SKILL.md` and add a line to the changelog below in the same
commit.

### Changelog

- **1.0.0** (2026-10-11): first version. Built from 25 sources researched and
  link-checked in 2026-10. Covers placement, component splitting, constants,
  helpers/utils/hooks, business-logic layers, the Server/Client boundary, import
  boundaries, a review checklist and the DevDigest overrides.

## Sources

All the links the skill is built from. The number matches the `#N` cited in
`SKILL.md`. Key points for each source are in [references.md](references.md).
Every link returned HTTP 200 when checked in 2026-10 except #12: Medium blocks
automated fetches, so it's listed for historical context only.

### A. Where files and components live
1. [Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure): Next.js docs (Vercel), v16.3, 2026
2. [FAQ: File Structure](https://legacy.reactjs.org/docs/faq-structure.html): React docs (legacy)
3. [Colocation](https://kentcdodds.com/blog/colocation): Kent C. Dodds, 2019
4. [bulletproof-react: Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md): Alan Alickovic
5. [React Folder Structure in 7 Steps](https://www.robinwieruch.de/react-folder-structure/): Robin Wieruch, updated 2026
6. [Delightful React File/Directory Structure](https://www.joshwcomeau.com/react/file-structure/): Josh W. Comeau
7. [Tao of React](https://alexkondov.com/tao-of-react/): Alex Kondov
8. [Feature-Sliced Design: Overview](https://feature-sliced.design/docs/get-started/overview): FSD
9. [Feature-Sliced Design: Usage with Next.js](https://feature-sliced.design/docs/guides/tech/with-nextjs): FSD

### B. How to split components
10. [Thinking in React](https://react.dev/learn/thinking-in-react): react.dev
11. [Container/Presentational Pattern](https://www.patterns.dev/react/presentational-container-pattern/): patterns.dev (Lydia Hallie, Addy Osmani)
12. [Presentational and Container Components](https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0): Dan Abramov, 2015 (2019 update) ⚠️ historical
13. [Headless Component: a pattern for composing React UIs](https://martinfowler.com/articles/headless-component.html): Juntao Qiu, martinfowler.com, 2023

### C. Business logic, hooks, state, data layer
14. [Modularizing React Applications with Established UI Patterns](https://martinfowler.com/articles/modularizing-react-apps.html): Juntao Qiu, martinfowler.com, 2023
15. [Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks): react.dev
16. [Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure): react.dev
17. [Application State Management with React](https://kentcdodds.com/blog/application-state-management-with-react): Kent C. Dodds, 2020
18. [Effective React Query Keys](https://tkdodo.eu/blog/effective-react-query-keys): Dominik Dorfmeister (TkDodo)
19. [How to think about data security in Next.js](https://nextjs.org/docs/app/guides/data-security): Next.js docs (Vercel), 2026
20. [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components): Next.js docs (Vercel), 2026

### D. Utils, helpers, constants, abstractions
21. [AHA Programming](https://kentcdodds.com/blog/aha-programming): Kent C. Dodds, 2020
22. [The Wrong Abstraction](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction): Sandi Metz, 2016
23. [Enums: Objects vs Enums](https://www.typescriptlang.org/docs/handbook/enums.html): TypeScript Handbook
24. [Please Stop Using Barrel Files](https://tkdodo.eu/blog/please-stop-using-barrel-files): Dominik Dorfmeister (TkDodo), 2024

### E. Enforcing boundaries
25. [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries): Javier Brea
