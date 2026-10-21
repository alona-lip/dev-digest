import type { CSSProperties } from "react";

export const s = {
  form: { display: "flex", flexDirection: "column" } satisfies CSSProperties,
  error: { marginBottom: 12, fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
} as const;
