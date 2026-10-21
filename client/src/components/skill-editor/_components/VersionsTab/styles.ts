import type { CSSProperties } from "react";

export const s = {
  wrap: { maxWidth: 1000 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  sub: { fontSize: 13, color: "var(--text-muted)", margin: "6px 0 18px" } satisfies CSSProperties,
  row: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
    marginBottom: 10,
  } satisfies CSSProperties,
  rowMain: { display: "flex", alignItems: "center", gap: 16, padding: "14px 18px" } satisfies CSSProperties,
  ver: { width: 32, fontSize: 14, fontWeight: 600, color: "var(--accent-text)" } satisfies CSSProperties,
  text: { flex: 1 } satisfies CSSProperties,
  message: { fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
  date: { fontSize: 12, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  current: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--ok)" } satisfies CSSProperties,
  dot: { width: 6, height: 6, borderRadius: 99, background: "var(--ok)" } satisfies CSSProperties,
  btns: { display: "flex", gap: 8 } satisfies CSSProperties,
  diff: {
    margin: 0,
    padding: "10px 0",
    borderTop: "1px solid var(--border)",
    background: "var(--code-bg)",
    fontSize: 12,
    lineHeight: "18px",
    overflow: "auto",
    maxHeight: 360,
  } satisfies CSSProperties,
  diffLine: (kind: "same" | "add" | "del"): CSSProperties => ({
    padding: "0 18px",
    whiteSpace: "pre-wrap",
    background: kind === "add" ? "var(--ok-bg)" : kind === "del" ? "var(--crit-bg)" : "transparent",
    color: kind === "add" ? "var(--ok)" : kind === "del" ? "var(--crit)" : "var(--text-secondary)",
  }),
} as const;
