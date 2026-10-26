import type { CSSProperties } from "react";

export const s = {
  // `marginTop: auto` pins the accordion to the bottom of the card's flex column.
  block: {
    marginTop: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    borderTop: "1px solid var(--border)",
    paddingTop: 14,
  } satisfies CSSProperties,
  header: {
    all: "unset",
    boxSizing: "border-box",
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  chevron: { flexShrink: 0, transition: "transform 120ms" } satisfies CSSProperties,
  chevronOpen: { flexShrink: 0, transition: "transform 120ms", transform: "rotate(180deg)" } satisfies CSSProperties,
  title: {
    flex: 1,
    margin: 0,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  count: { fontSize: 12, fontVariantNumeric: "tabular-nums" } satisfies CSSProperties,
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  row: { display: "flex", alignItems: "baseline", gap: 10, fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  pr: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  link: { color: "var(--text-primary)", textDecoration: "none" } satisfies CSSProperties,
  num: { color: "var(--text-muted)", marginRight: 6, fontVariantNumeric: "tabular-nums" } satisfies CSSProperties,
  overlap: { cursor: "help", whiteSpace: "nowrap" } satisfies CSSProperties,
  date: { minWidth: 80, textAlign: "right", whiteSpace: "nowrap" } satisfies CSSProperties,
  note: { margin: 0, fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
