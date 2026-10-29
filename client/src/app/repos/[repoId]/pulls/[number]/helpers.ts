/* helpers.ts — pure functions shared by the PR detail route's components. */
import type { FindingRecord } from "@devdigest/shared";

/** Blockers = open (not dismissed) CRITICAL findings. One rule for the PR Brief and the
    Findings tab's run accordion, so both always show the same count for a review. */
export function countBlockers(findings: readonly Pick<FindingRecord, "severity" | "dismissed_at">[]): number {
  return findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length;
}

export interface DiffTarget {
  file: string;
  line: number | null;
}

/** Deep-link target from the URL (`?file=…&line=…`). `file` is only ever compared to rendered
    paths, never fetched. `line` must be an integer ≥ 1, else it is dropped (file still opens). */
export function parseDiffTarget(search: { get(key: string): string | null }): DiffTarget | null {
  const file = search.get("file");
  if (!file) return null;
  const raw = search.get("line");
  const n = raw != null && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return { file, line: Number.isSafeInteger(n) && n >= 1 ? n : null };
}

/** Query string (no leading `?`) that opens the Diff tab on `file`/`line`, keeping every other
    param (`severity`, `trace`, …). A null `line` removes the param. */
export function diffTargetQuery(sp: URLSearchParams, file: string, line: number | null): string {
  const next = new URLSearchParams(sp.toString());
  next.set("tab", "diff");
  next.set("file", file);
  if (line == null) next.delete("line");
  else next.set("line", String(line));
  return next.toString();
}
