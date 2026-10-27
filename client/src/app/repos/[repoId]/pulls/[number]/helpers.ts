/* helpers.ts — pure functions shared by the PR detail route's components. */
import type { FindingRecord } from "@devdigest/shared";

/** Blockers = open (not dismissed) CRITICAL findings. One rule for the PR Brief and the
    Findings tab's run accordion, so both always show the same count for a review. */
export function countBlockers(findings: readonly Pick<FindingRecord, "severity" | "dismissed_at">[]): number {
  return findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length;
}
