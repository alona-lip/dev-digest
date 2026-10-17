import { DEFAULT_TAB, TABS, type EditorTab } from "./constants";

/** `?tab=` → a known tab (unknown/missing → Config). */
export function parseTabParam(raw: string | null): EditorTab {
  return TABS.some((t) => t.key === raw) ? (raw as EditorTab) : DEFAULT_TAB;
}

/** Rough token estimate (chars / 4) for text that is not saved yet. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** The file name shown on the body editor's header. */
export function bodyFileName(name: string): string {
  const base = name.trim().replace(/[^\w.-]+/g, "-") || "skill";
  return `${base}.md`;
}
