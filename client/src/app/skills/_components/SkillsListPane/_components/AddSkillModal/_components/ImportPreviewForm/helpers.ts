import type { SkillImportPreview } from "@devdigest/shared";

/**
 * The server flags a name clash for the ORIGINAL name; once the user edits the
 * name the flag is stale, so it only applies while the name is unchanged.
 */
export function hasNameConflict(preview: SkillImportPreview, currentName: string): boolean {
  return preview.name_conflict && currentName.trim() === preview.name;
}
