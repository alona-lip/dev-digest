import { DEFAULT_TAB, TABS, type EditorTab } from "./constants";

/** `?tab=` → a known tab (unknown/missing → Config). */
export function parseTabParam(raw: string | null): EditorTab {
  return TABS.some((t) => t.key === raw) ? (raw as EditorTab) : DEFAULT_TAB;
}
