import type { IconName } from "@devdigest/ui";
import type { SkillSource } from "@devdigest/shared";

/** Icon per skill source, shown next to the source label on a card. */
export const SOURCE_ICONS: Record<SkillSource, IconName> = {
  manual: "Edit",
  imported_url: "Link",
  imported_file: "Upload",
  extracted: "Wrench",
  community: "Globe",
};
