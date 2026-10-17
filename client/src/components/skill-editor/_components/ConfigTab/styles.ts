import type { CSSProperties } from "react";

export const s = {
  wrap: { maxWidth: 860 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10, marginBottom: 20 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  enabledLabel: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
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
  actions: { display: "flex", gap: 10, marginTop: 10, alignItems: "center" } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
} as const;
