import type { IconName } from "@devdigest/ui";

export type EditorTab = "config" | "preview" | "evals" | "stats" | "versions" | "context";

/** Tabs of an existing skill; labels resolve under `skills.tabs.*`. */
export const TABS: readonly { key: EditorTab; icon: IconName }[] = [
  { key: "config", icon: "Settings" },
  { key: "preview", icon: "Eye" },
  { key: "evals", icon: "FlaskConical" },
  { key: "stats", icon: "BarChart" },
  { key: "versions", icon: "History" },
  { key: "context", icon: "FileText" },
];

export const DEFAULT_TAB: EditorTab = "config";
