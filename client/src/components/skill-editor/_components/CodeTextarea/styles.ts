import type { CSSProperties } from "react";

const LINE = 20;

export const s = {
  wrap: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 12px",
    borderBottom: "1px solid var(--border)",
    fontSize: 12,
  } satisfies CSSProperties,
  file: { color: "var(--text-secondary)" } satisfies CSSProperties,
  unsaved: {
    padding: "1px 8px",
    borderRadius: 4,
    background: "var(--bg-hover)",
    color: "var(--text-muted)",
    fontSize: 11,
  } satisfies CSSProperties,
  tokens: { marginLeft: "auto", color: "var(--text-muted)" } satisfies CSSProperties,
  editor: { display: "flex", height: 360, background: "var(--code-bg)" } satisfies CSSProperties,
  gutter: {
    width: 44,
    flexShrink: 0,
    overflow: "hidden",
    padding: "12px 10px 12px 0",
    textAlign: "right",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 13,
    lineHeight: `${LINE}px`,
    color: "var(--text-muted)",
    userSelect: "none",
  } satisfies CSSProperties,
  textarea: {
    flex: 1,
    resize: "none",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "var(--text-primary)",
    padding: "12px 12px 12px 0",
    fontSize: 13,
    lineHeight: `${LINE}px`,
    whiteSpace: "pre",
    overflow: "auto",
  } satisfies CSSProperties,
} as const;
