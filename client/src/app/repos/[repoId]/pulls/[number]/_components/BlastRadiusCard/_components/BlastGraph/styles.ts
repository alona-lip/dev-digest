import type { CSSProperties } from "react";
import type { NodeKind } from "./constants";

/** One distinct bright hue per kind, per theme — tokens in `src/app/globals.css`. */
export const NODE_COLOR: Record<NodeKind, string> = {
  symbol: "var(--graph-symbol)",
  caller: "var(--graph-caller)",
  endpoint: "var(--graph-endpoint)",
  cron: "var(--graph-cron)",
};

/** Opacity of everything not connected to the hovered symbol. */
export const DIMMED_OPACITY = 0.2;

export const s = {
  svg: { width: "100%", height: "auto", display: "block" } satisfies CSSProperties,
  fade: { transition: "opacity .15s" } satisfies CSSProperties,
  symbolNode: { transition: "opacity .15s", cursor: "pointer" } satisfies CSSProperties,
  legendRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    marginTop: 12,
  } satisfies CSSProperties,
  modalBody: { padding: "18px 24px" } satisfies CSSProperties,
  nodeText: { fontFamily: "var(--font-mono, monospace)", fontSize: 11, fill: "var(--text-primary)" } satisfies CSSProperties,
  empty: { margin: 0, fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  legend: { display: "flex", gap: 16, flexWrap: "wrap", listStyle: "none", margin: 0, padding: 0 } satisfies CSSProperties,
  legendItem: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  swatch: { width: 12, height: 12, borderRadius: 3, border: "2px solid", display: "inline-block" } satisfies CSSProperties,
} as const;
