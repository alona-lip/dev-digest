import type { SkillListItem } from "@devdigest/shared";

/** `0.714` → `"71%"`; null (no data yet) → `"—"`, never `0%`. */
export function formatRate(rate: number | null | undefined): string {
  return rate == null ? "—" : `${Math.round(rate * 100)}%`;
}

/** Case-insensitive match on name + description. */
export function filterSkills<T extends Pick<SkillListItem, "name" | "description">>(
  skills: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
}
