import type { CSSProperties } from "react";

export const s = {
  meta: { display: "flex", justifyContent: "flex-end", marginTop: 8 } satisfies CSSProperties,
  empty: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    marginTop: 8,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: 6,
  } satisfies CSSProperties,
  emptyTitle: { margin: 0, fontSize: 14, color: "var(--text-primary)" } satisfies CSSProperties,
  emptyHint: { margin: "0 0 6px", fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { margin: "0 0 8px", fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
  note: { margin: "8px 0 0", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  block: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: 18,
  } satisfies CSSProperties,
  blockTop: { display: "flex", justifyContent: "flex-end", marginBottom: 8 } satisfies CSSProperties,
  summary: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
