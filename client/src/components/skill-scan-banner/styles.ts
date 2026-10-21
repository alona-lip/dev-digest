import type { CSSProperties } from "react";

export const s = {
  banner: {
    padding: "12px 16px",
    background: "var(--crit-bg)",
    borderBottom: "1px solid var(--crit)",
    color: "var(--text-primary)",
    fontSize: 13,
  } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  icon: { color: "var(--crit)", flexShrink: 0 } satisfies CSSProperties,
  title: {
    color: "var(--crit)",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  } satisfies CSSProperties,
  text: { color: "var(--text-secondary)" } satisfies CSSProperties,
  list: { listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 6 } satisfies CSSProperties,
  item: {
    display: "grid",
    gridTemplateColumns: "64px 1fr auto",
    columnGap: 10,
    rowGap: 2,
    alignItems: "baseline",
  } satisfies CSSProperties,
  where: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  label: { fontSize: 12.5, color: "var(--text-primary)" } satisfies CSSProperties,
  source: { padding: "0 6px", border: "1px solid var(--crit)" } satisfies CSSProperties,
  excerpt: {
    gridColumn: "2 / 4",
    fontSize: 12,
    color: "var(--text-secondary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
};
