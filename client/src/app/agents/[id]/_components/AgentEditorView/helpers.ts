import { VALID_TABS, type EditorTab } from "./constants";

/** `?tab=` → a tab the editor can show (unknown/missing → the first one). */
export function parseTabParam(raw: string | null): EditorTab {
  return (VALID_TABS as readonly string[]).includes(raw ?? "") ? (raw as EditorTab) : VALID_TABS[0];
}
