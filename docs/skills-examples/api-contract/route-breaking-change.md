---
name: route-breaking-change
description: Use when a diff changes an HTTP route, its method, path, params, status codes or request/response shape. Decide whether an existing caller breaks and report each breaking change with the caller it breaks.
type: rubric
---
# Route breaking changes

A change is **breaking** when a caller written against the old contract stops working:

- a route, method or path is renamed or removed;
- a request field becomes required, is renamed, or is retyped;
- a response field is removed, renamed, retyped, or can now be `null`;
- a status code or error shape that callers branch on changes;
- validation gets stricter for input that was valid before.

A change is **not** breaking when it only adds an optional request field, adds a response field, or loosens validation.

For each breaking change report: the route, what changed (old → new), and which kind of caller breaks (the web client, the CI runner, an external integration). Severity: CRITICAL if a caller in this repository breaks and the diff does not update it; WARNING otherwise.
