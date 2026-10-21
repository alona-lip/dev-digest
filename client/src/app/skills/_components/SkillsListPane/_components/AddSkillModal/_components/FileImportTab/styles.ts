import type { CSSProperties } from "react";

export const s = {
  drop: (over: boolean): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    padding: "40px 20px",
    border: "2px dashed " + (over ? "var(--accent)" : "var(--border-strong)"),
    borderRadius: 12,
    background: over ? "var(--accent-bg)" : "var(--bg-surface)",
    color: "var(--text-secondary)",
    cursor: "pointer",
    textAlign: "center",
    fontSize: 14,
  }),
  hint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { marginTop: 12, fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
} as const;
