import type { ContextDocType } from "@devdigest/shared";

/** Badge colours per document type — the badge also carries a text label, never colour alone. */
export const TYPE_COLORS: Record<ContextDocType, { color: string; bg: string }> = {
  specs: { color: "var(--accent-text)", bg: "var(--accent-bg)" },
  docs: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
  insights: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
};
