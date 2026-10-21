---
name: deprecation-policy
description: Use when a diff removes, renames or replaces a public route, request/response field, enum value or exported symbol. Check that the old contract was deprecated first — marked, with a named replacement, and served side by side for at least one release; report silent removal and deprecations that do not name the replacement.
type: convention
---
# Deprecation policy

A public contract is never removed in the same change that replaces it. Removal is a two-step process:

1. **Deprecate.** Add the replacement and keep the old contract working. Mark the old one where callers will see it:
   - TS: `/** @deprecated use severity_counts — removed in 2.0 */`;
   - zod: `.describe('Deprecated: use severity_counts')`;
   - HTTP: `Deprecation: true` and `Sunset: <date>` response headers, plus a `Link` header to the new route;
   - a CHANGELOG / README line naming what replaces it.
2. **Remove** in a later release (a major — see semver-discipline), once the deprecation has shipped.

## What to report

- **Silent removal** — a route, field, enum value or export disappears with no earlier `@deprecated` marker in the codebase: WARNING; **CRITICAL** if an in-repo caller still uses it.
- **Deprecation without a replacement** — `@deprecated` with no "use X instead": SUGGESTION.
- **Deprecated but broken** — the old contract is marked but now returns different data or a different status: treat it as a breaking change.

Do not report removal of something already marked `@deprecated` before this diff, if its replacement exists.

## Example

**Bad** — the field disappears in one diff:

```ts
  export const Review = z.object({
-   score: z.number(),
+   quality: z.number(),
  });
```

→ WARNING (CRITICAL if the client reads `score`): `score` removed with no deprecation; callers get no warning.

**Good** — both fields ship, the old one is marked with its replacement:

```ts
  export const Review = z.object({
-   score: z.number(),
+   score: z.number().describe('Deprecated: use quality — removed in 2.0'),
+   quality: z.number(),
  });
```
