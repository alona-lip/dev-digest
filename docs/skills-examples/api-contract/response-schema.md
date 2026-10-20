---
name: response-schema
description: Use when a diff changes the shape of a response — a zod contract in */vendor/shared/contracts, a route's return type, or a serializer/DTO mapper. Compare old and new field names, types and optionality on the wire; report every change a consumer that parses the old shape cannot handle.
type: rubric
---
# Response schema changes

The wire shape is the contract. A consumer breaks when a response:

- **drops or renames** a field (`findings_by_severity` → `severity_counts`);
- **retypes** a field (`number` → `string`, array → object, ISO string → epoch number);
- **loosens a guarantee**: required → optional, non-null → `.nullable()` (the consumer never handled `null`);
- **removes or renames an enum value** (`WARNING` → `WARN`) or changes its case;
- **changes case on the wire** (`cost_usd` → `costUsd`). In this repo the wire is `snake_case`, enum values are `UPPER_CASE`, and the TS ↔ wire mapping is explicit at the boundary.

**Not breaking:** a new optional field, a new enum value the consumer ignores, optional → required on a response (consumers only gain a guarantee).

## Vendored contracts

`server/src/vendor/shared` is copied into `client/` and `reviewer-core/`. If the diff changes a contract on one side only, the copies drift: report it and name the copy that was not updated.

## Severity

- **CRITICAL** — a consumer in this repository reads the changed field and is not updated in the diff.
- **WARNING** — a nullable/optional loosening with no visible consumer, or a change to a contract only external callers use.

## Example

**Bad** — field renamed in the server contract; `FindingsPopover` still reads `findings_by_severity`:

```ts
  export const PrAgentFindings = z.object({
-   findings_by_severity: SeverityCounts,
+   severity_counts: SeverityCounts,
  });
```

→ CRITICAL: `PrAgentFindings.findings_by_severity` removed; `client/src/components/severity/FindingsPopover.tsx` renders `undefined`.

**Good** — the new field is added next to the old one; the old one is removed in a later release:

```ts
  export const PrAgentFindings = z.object({
-   findings_by_severity: SeverityCounts,
+   /** @deprecated use severity_counts */
+   findings_by_severity: SeverityCounts,
+   severity_counts: SeverityCounts,
  });
```
