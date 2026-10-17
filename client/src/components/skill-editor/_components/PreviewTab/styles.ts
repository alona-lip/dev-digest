import type { CSSProperties } from "react";

export const s = {
  wrap: { maxWidth: 860 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  sub: { fontSize: 13, color: "var(--text-muted)", margin: "4px 0 16px" } satisfies CSSProperties,
  card: {
    padding: "20px 24px",
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    fontSize: 14,
  } satisfies CSSProperties,
};
