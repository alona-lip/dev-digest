/** Editor tabs reachable via `?tab=` today; anything else falls back to the first. */
export const VALID_TABS = ["config", "skills"] as const;
export type EditorTab = (typeof VALID_TABS)[number];
