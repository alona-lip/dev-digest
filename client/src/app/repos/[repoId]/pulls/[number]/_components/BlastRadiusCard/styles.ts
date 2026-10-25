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
  toggle: { display: "inline-flex", gap: 6 } satisfies CSSProperties,
  summary: { display: "flex", gap: 28, flexWrap: "wrap", margin: 0, padding: 0 } satisfies CSSProperties,
  stat: { display: "flex", flexDirection: "column-reverse", gap: 2 } satisfies CSSProperties,
  statValue: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    color: "var(--text-primary)",
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,
  statLabel: {
    margin: 0,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  degraded: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  resyncError: { fontSize: 12.5, color: "var(--danger, #c0392b)" } satisfies CSSProperties,
  none: { margin: 0, fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
