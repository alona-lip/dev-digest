import type { SkillType } from "@devdigest/shared";

/** One tint per skill type, from the theme tokens (works in light and dark). */
export const TYPE_COLORS: Record<SkillType, { color: string; bg: string }> = {
  rubric: { color: "var(--accent-text)", bg: "var(--accent-bg)" },
  convention: { color: "var(--ok)", bg: "var(--ok-bg)" },
  security: { color: "var(--crit)", bg: "var(--crit-bg)" },
  custom: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
};
