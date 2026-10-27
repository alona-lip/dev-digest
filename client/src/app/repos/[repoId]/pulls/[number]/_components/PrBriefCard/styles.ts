import type { CSSProperties } from "react";

export const s = {
  meta: { display: "flex", justifyContent: "flex-end", marginTop: 8 } satisfies CSSProperties,
  empty: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  emptyTitle: { margin: 0, fontSize: 14, color: "var(--text-primary)" } satisfies CSSProperties,
  emptyHint: { margin: 0, fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
