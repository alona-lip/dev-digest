import type { SkillType } from "@devdigest/shared";

/** Mirrors the server's import limit — rejected here first to save the upload. */
export const MAX_IMPORT_BYTES = 512 * 1024;
export const ACCEPT = ".md,.markdown,.zip";
export const SKILL_TYPES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];
