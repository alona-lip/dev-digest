import type { FindingRecord, Severity } from "@devdigest/shared";
import { SEVERITY_ORDER } from "@/components/severity";
import { LOW_CONFIDENCE_THRESHOLD } from "./constants";

/** Optionally drop low-confidence findings, optionally keep only one severity,
 *  and sort by severity. `severity` is applied AFTER `hideLow` so a pill's
 *  count (tallied from the hideLow-only result, see `countBySeverity`) always
 *  matches the number of cards this filter narrows down to. */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severity?: Severity | null,
): FindingRecord[] {
  let shown = findings;
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  if (severity) shown = shown.filter((f) => f.severity === severity);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}
