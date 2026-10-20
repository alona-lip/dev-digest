---
name: breaking-change
description: Use when a diff changes or removes a public contract — an HTTP route (method, path, params, status codes, request body) or an exported function/type that another package imports. Decide whether a caller written against the old contract breaks; report each breaking change as old → new together with the caller it breaks.
type: rubric
---
# Breaking changes to a public contract

A change is **breaking** when a caller written against the old contract stops working:

- a route, method or path is renamed or removed (`GET /pulls/:id` → `GET /pulls/:id/details`);
- a path/query param or request field is added as required, renamed, or retyped;
- validation gets stricter for input that was valid before (`z.string()` → `z.string().uuid()`);
- a success or error status code that callers branch on changes (`201` → `200`, `404` → `400`);
- an exported function gains a required parameter, reorders or retypes parameters, or changes its return type.

**Not breaking:** a new route; a new optional request field; a new response field; looser validation; a rename that updates every caller in the same diff.

## How to report

For each breaking change: the contract, what changed (old → new), and the caller that breaks (the web client in `client/`, the CI runner, `reviewer-core`, an external integration). Search the repo for the path or symbol name to find callers.

- **CRITICAL** — a caller in this repository breaks and the diff does not update it.
- **WARNING** — only external or unknown callers break.
- One finding per changed contract; do not repeat it for every call site.

## Example

**Bad** — route renamed, `client/src/lib/hooks/core.ts` still calls `/pulls/${prId}`:

```ts
- app.get('/pulls/:id', { schema: { params: IdParams } }, handler);
+ app.get('/pulls/:id/details', { schema: { params: IdParams } }, handler);
```

→ CRITICAL: `GET /pulls/:id` removed; the PR page in the client gets 404.

**Good** — the new route is added and the old one stays as a deprecated alias:

```ts
  app.get('/pulls/:id', { schema: { params: IdParams } }, handler); // @deprecated → /pulls/:id/details
+ app.get('/pulls/:id/details', { schema: { params: IdParams } }, handler);
```
