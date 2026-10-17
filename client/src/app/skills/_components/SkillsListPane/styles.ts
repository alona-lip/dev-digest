import type { CSSProperties } from "react";

export const s = {
  pane: {
    width: 320,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  header: { padding: "16px 16px 12px" } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 14 } satisfies CSSProperties,
  title: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  search: { position: "relative" } satisfies CSSProperties,
  searchIcon: {
    position: "absolute",
    left: 11,
    top: "50%",
    transform: "translateY(-50%)",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  searchInput: {
    width: "100%",
    padding: "9px 12px 9px 32px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    fontSize: 13,
  } satisfies CSSProperties,
  list: { flex: 1, overflow: "auto", padding: "0 12px 12px" } satisfies CSSProperties,
};
