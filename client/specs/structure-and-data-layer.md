# Client structure & data layer pass (2026-10-12)

Status: implemented (2026-10-12).

Fixes from the skill-driven audit (`frontend-architecture`,
`react-best-practices`, `next-best-practices`, `react-testing-library`).
No behaviour change for a user except where listed under "Visible changes".

## Decisions

- **Thin route entries everywhere.** Every `page.tsx` is a server component
  that awaits `params`, names the tab (`metadata` / `generateMetadata`, root
  template `%s · DevDigest`) and renders one view from `_components/`:
  `PrDetailView`, `PullsListView`, `AgentEditorView`, `HomeView`. Views receive
  route params as props instead of calling `useParams`.
- **Next file conventions.** `app/error.tsx`, `app/global-error.tsx`,
  `app/not-found.tsx`; `/settings/<unknown>` calls `notFound()`.
- **Suspense at the leaves.** The root layout no longer wraps every provider
  in `<Suspense>` — with it, every response streamed before the page ran and
  `notFound()` could only render a 404 page with a **200** status. The three
  views that read `useSearchParams` are wrapped at their own page.
- **Data layer owns invalidation.** Each `lib/hooks/<domain>.ts` has a private
  query-key factory. Run lifecycle mutations (`useRunReview`, `useCancelRun`,
  `useDeleteRun`) refresh in-flight runs + run history + reviews;
  `useRefreshPrRuns` replaces the page's own `useQueryClient` calls;
  `useDeleteRepo` drops the deleted repo's PR list.
- **One source per lookup.** Severity colour = `SEV` (`@devdigest/ui`), order =
  `SEVERITY_ORDER` and `countBySeverity` (`@/components/severity`). PR-list
  lookups are keyed by `PrStatus` / `PrSize`.
- **Boundaries are linted.** `eslint.config.mjs`: no shared → `app/` imports,
  no cross-route `_components` imports, `@/` instead of `../../../`
  (`@messages/*` alias for `messages/`). `AgentCard` moved to
  `src/components/agent-card/`.
- **React.** Context values memoised; `ConfigTab` resets via `key={agent.id}`
  instead of a re-sync effect; `FileCard` keyed by path; real `<button>`s for
  the Timeline delete action and the Run Review trigger (`aria-expanded`).
- **Tests.** `@testing-library/user-event` for clicks/hovers; `fireEvent` kept
  only for `scroll` and the fake-timer "cursor in transit" popover cases. New:
  `lib/api.test.ts`, `lib/hooks/reviews.test.tsx` (invalidation), pure helper
  tests for the PR list and Timeline.

## Visible changes

- Tab titles per page; unknown routes and settings sections return a real 404.
- `?sort=` on the PR list is in the URL (search stays local state — a
  `router.replace` per keystroke made typing lag).
- Trace drawer tabs are translated ("Trace", "Live log") and a live run's
  trace opens on the streaming log.
- Trace-drawer SUGGESTION badges use the same colour as the finding cards.

## Rejected

- **`next/font/google`** — downloads fonts at build time; this is a
  local-first app whose build must work offline.
- **Moving `AppShell` into a route-group layout** — every page passes its own
  breadcrumb into the shell; that needs a breadcrumb context first. Worth its
  own spec.

## Not done

- Remaining English literals (`AddRepoView`, diff-viewer `CodeLine`,
  `app-shell` helpers, `feature-models` labels).
- Tests for `ConfigTab`, `CreateAgentModal`, `AddRepoView`, `Settings*`.
- Dead-looking code kept on purpose (course scaffolding for later lessons):
  `components/mermaid-diagram`, `FeaturePlaceholder`, `showcase`, unused
  `repo-intel`/context hooks, unused i18n namespaces.
