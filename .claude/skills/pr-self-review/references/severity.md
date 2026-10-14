# Severity — one definition for every skill

Same three levels as the product's own reviewer
(`docs/agent-prompts/general-reviewer.md`). **Only CRITICAL blocks.**

- **CRITICAL** — once merged, this can cause a security breach, data
  loss/corruption, a wrong result, a crash, or a broken contract callers depend
  on. Also: touching a do-not-touch zone (applied migration, lock file edited
  by hand) — those come from the deterministic checks, not from you.
- **WARNING** — a real problem worth fixing that does not block: a missed edge
  case, degraded behaviour, a structure/maintainability/perf risk.
- **SUGGESTION** — a minor improvement; safe to merge without it.

## Skills' own "CRITICAL" labels are not findings

`react-best-practices`, `zod` and others tag whole rule *categories*
"CRITICAL". That is the priority of the category, not the severity of a
finding. A violated rule becomes a CRITICAL **finding** only if you can state
the concrete mechanism: which input or path reaches it, and what breaks.

| Violation | Severity |
|---|---|
| Route reads a row by id with no workspace scope (cross-tenant read) | CRITICAL |
| SQL built by string concatenation from request input | CRITICAL |
| Secret / token written to a log or response | CRITICAL |
| Unvalidated `req.body` used as a trusted value at a boundary | CRITICAL |
| Response shape changed while the client contract still expects the old one | CRITICAL |
| Missing `await` on a write whose result is then returned as success | CRITICAL |
| Component in the wrong folder, helper in a component file | WARNING |
| Route holds business logic that belongs in a service | WARNING |
| Derived value stored in state (`useState` + `useEffect` sync) | WARNING |
| `any` / needless cast with no observable failure path | WARNING |
| Naming, ordering, a nicer type | SUGGESTION |

Speculation ("might", "could", "if X isn't handled elsewhere") is at most
WARNING. If you would dismiss your own finding as a likely false positive, do
not report it. Cap: a skill may have a maximum severity in `routing.json`
(`caps`); a finding above the cap is reported at the cap.

## Legitimate migration edits

`pnpm db:generate` adds a new `NNNN_*.sql`, a new snapshot, and **appends** an
entry to `meta/_journal.json`. That is allowed. Editing, deleting or renaming
any existing one is CRITICAL (`checks.mjs`).
