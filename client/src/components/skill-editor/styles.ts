import type { CSSProperties } from "react";

export const s = {
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 28px 0",
    flexShrink: 0,
  } satisfies CSSProperties,
  icon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    background: "var(--accent-bg)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
  } satisfies CSSProperties,
  title: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  actions: { marginLeft: "auto" } satisfies CSSProperties,
  tabsBar: { marginTop: 8, flexShrink: 0 } satisfies CSSProperties,
  body: { flex: 1, minHeight: 0, overflow: "auto", padding: 28 } satisfies CSSProperties,
  skeleton: { padding: 28, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
};
