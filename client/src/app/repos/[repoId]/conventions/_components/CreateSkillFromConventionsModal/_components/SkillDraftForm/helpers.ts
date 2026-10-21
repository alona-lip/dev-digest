import type { ConventionSkillDraft } from "@devdigest/shared";
import { DEFAULT_AGENT_NAME } from "./constants";

/** General Reviewer when present, else the first agent; "" when there are none. */
export function defaultAgentId(agents: { id: string; name: string }[]): string {
  return agents.find((a) => a.name === DEFAULT_AGENT_NAME)?.id ?? agents[0]?.id ?? "";
}

/**
 * The version this save will write: the next version of the existing skill when the
 * name is still the draft's, else v1. (A rename onto another existing skill is only
 * known after saving — the toast reports the real version.)
 */
export function nextVersion(draft: ConventionSkillDraft, name: string): number {
  return draft.existing_skill && name.trim() === draft.name ? draft.existing_skill.version + 1 : 1;
}
