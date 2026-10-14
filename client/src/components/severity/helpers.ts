import type { FindingRecord, Severity } from "@devdigest/shared";

/** Tally findings by severity, every level present (zero when absent) —
 *  plain `Array.filter`, no LLM call. Shared by the PR-detail filter chips and
 *  the Timeline tiles. Callers pass the SAME array they're about to render
 *  (post-hideLow, pre-severity) so the count always equals the cards shown. */
export function countBySeverity(findings: FindingRecord[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) {
    if (f.severity in counts) counts[f.severity] += 1;
  }
  return counts;
}
