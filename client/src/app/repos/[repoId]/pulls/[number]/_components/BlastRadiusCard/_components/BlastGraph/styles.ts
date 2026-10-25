import type { CSSProperties } from "react";
import type { NodeKind } from "./constants";

export const NODE_COLOR: Record<NodeKind, string> = {
  symbol: "var(--accent)",
  caller: "var(--border-strong)",
  endpoint: "var(--info)",
  cron: "var(--warn)",
};

export const s = {
  svg: { width: "100%", height: "auto", display: "block" } satisfies CSSProperties,
  nodeText: { fontFamily: "var(--font-mono, monospace)", fontSize: 11, fill: "var(--text-primary)" } satisfies CSSProperties,
  empty: { margin: 0, fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  legend: { display: "flex", gap: 16, flexWrap: "wrap", listStyle: "none", margin: "12px 0 0", padding: 0 } satisfies CSSProperties,
  legendItem: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  swatch: { width: 12, height: 12, borderRadius: 3, border: "2px solid", display: "inline-block" } satisfies CSSProperties,
} as const;
