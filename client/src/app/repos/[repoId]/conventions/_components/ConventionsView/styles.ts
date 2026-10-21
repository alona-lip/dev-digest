import type { CSSProperties } from "react";

export const s = {
  page: { maxWidth: 1040, margin: "0 auto", padding: "32px 32px 48px" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 20 } satisfies CSSProperties,
  title: { margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  titleRepo: { color: "var(--accent)" } satisfies CSSProperties,
  subtitle: { margin: "8px 0 0", fontSize: 14, color: "var(--text-secondary)" } satisfies CSSProperties,
  headerActions: { marginLeft: "auto", display: "flex", gap: 10 } satisfies CSSProperties,
  toolbar: { display: "flex", alignItems: "center", gap: 12, marginBottom: 16 } satisfies CSSProperties,
  count: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  toolbarRight: { marginLeft: "auto" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  emptyCard: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
} as const;
