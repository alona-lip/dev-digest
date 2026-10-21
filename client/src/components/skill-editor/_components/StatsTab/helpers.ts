import type { SkillStats } from "@devdigest/shared";

/** Fixed order → a category keeps its colour whatever else is filtered. */
export const CATEGORY_COLORS: Record<string, string> = {
  security: "var(--crit)",
  bug: "var(--warn)",
  perf: "var(--accent)",
  style: "var(--ok)",
  test: "var(--accent-text)",
};
export const OTHER_COLOR = "var(--text-muted)";

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? OTHER_COLOR;
}

export function enabledAgentCount(stats: Pick<SkillStats, "used_by">): number {
  return stats.used_by.filter((a) => a.enabled).length;
}

/** 0..1 → whole percent for the ring, or null when there is no data. */
export function percent(rate: number | null): number | null {
  return rate == null ? null : Math.round(rate * 100);
}
