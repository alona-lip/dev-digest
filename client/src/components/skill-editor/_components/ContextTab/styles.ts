import type { CSSProperties } from "react";

export const s = {
  wrap: { maxWidth: 860 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  sub: { fontSize: 13, color: "var(--text-muted)", margin: "4px 0 16px" } satisfies CSSProperties,
  serializesLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    margin: "20px 0 6px",
  } satisfies CSSProperties,
  serializes: {
    margin: 0,
    padding: "12px 16px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    fontSize: 12,
    whiteSpace: "pre-wrap",
  } satisfies CSSProperties,
};
