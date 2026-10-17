import type { CSSProperties } from "react";

export const s = {
  layout: { display: "flex", height: "calc(100vh - 52px)" } satisfies CSSProperties,
  detail: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 } satisfies CSSProperties,
};
