import type { CSSProperties } from "react";

export const s = {
  list: { display: "flex", flexDirection: "column", gap: 8, margin: 0, padding: 0, listStyle: "none" } satisfies CSSProperties,
  group: { border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-surface)" } satisfies CSSProperties,
  header: {
    all: "unset",
    boxSizing: "border-box",
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    cursor: "pointer",
    color: "var(--text-primary)",
    fontSize: 13,
  } satisfies CSSProperties,
  symbol: { fontFamily: "var(--font-mono, monospace)", fontWeight: 600 } satisfies CSSProperties,
  count: { marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  body: { padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  callers: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  caller: { display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5 } satisfies CSSProperties,
  path: { fontFamily: "var(--font-mono, monospace)", color: "var(--text-secondary)", wordBreak: "break-all" } satisfies CSSProperties,
  link: { fontFamily: "var(--font-mono, monospace)", color: "var(--accent-text)", wordBreak: "break-all" } satisfies CSSProperties,
  callerName: { fontFamily: "var(--font-mono, monospace)", color: "var(--text-muted)", whiteSpace: "nowrap" } satisfies CSSProperties,
  chips: { display: "flex", flexWrap: "wrap", gap: 6 } satisfies CSSProperties,
} as const;
