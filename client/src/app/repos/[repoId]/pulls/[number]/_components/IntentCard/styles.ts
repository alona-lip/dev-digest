import type { CSSProperties } from "react";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
  quote: {
    margin: 0,
    paddingLeft: 12,
    borderLeft: "3px solid var(--accent)",
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  columns: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 16,
  } satisfies CSSProperties,
  listTitle: {
    margin: "0 0 8px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  item: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 13,
    lineHeight: 1.45,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  inScopeIcon: { color: "var(--ok)", flexShrink: 0, marginTop: 2 } satisfies CSSProperties,
  outOfScopeIcon: { color: "var(--text-muted)", flexShrink: 0, marginTop: 2 } satisfies CSSProperties,
  none: { margin: 0, fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { margin: 0, fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
} as const;
