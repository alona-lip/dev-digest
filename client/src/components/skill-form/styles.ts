import type { CSSProperties } from "react";

export const s = {
  modes: { display: "flex", gap: 4 } satisfies CSSProperties,
  mode: (on: boolean): CSSProperties => ({
    border: "none",
    borderRadius: 5,
    padding: "3px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    background: on ? "var(--bg-hover)" : "transparent",
    color: on ? "var(--text-primary)" : "var(--text-muted)",
  }),
  preview: {
    minHeight: 200,
    padding: "16px 20px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    fontSize: 14,
  } satisfies CSSProperties,
} as const;
