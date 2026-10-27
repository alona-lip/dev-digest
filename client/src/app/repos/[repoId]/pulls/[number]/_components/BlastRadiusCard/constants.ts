import type { BlastDegradedReason } from "@devdigest/shared";
import type { BlastCounts } from "./helpers";

export const BLAST_VIEW = { TREE: "tree", GRAPH: "graph" } as const;
export type BlastView = (typeof BLAST_VIEW)[keyof typeof BLAST_VIEW];

/** i18n keys are camelCase, the wire values are snake_case: an explicit lookup keeps it type-checked. */
export const REASON_KEY = {
  flag_off: "reason.flagOff",
  index_failed: "reason.indexFailed",
  index_partial: "reason.indexPartial",
  repo_too_large: "reason.repoTooLarge",
  no_data: "reason.noData",
} as const satisfies Record<BlastDegradedReason, string>;

/** With the flag off a resync cannot help, so no Resync button. */
export const NO_RESYNC_REASON: BlastDegradedReason = "flag_off";

export const STAT_KEYS = ["symbols", "callers", "endpoints", "crons"] as const satisfies readonly (keyof BlastCounts)[];
