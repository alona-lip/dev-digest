import type { Risk } from "@devdigest/shared";
import { SEVERITY_RANK } from "./constants";

/** Stable sort: high, medium, low; model order kept within a severity (AC-43). */
export function sortBySeverity(risks: readonly Risk[]): Risk[] {
  return risks
    .map((risk, index) => ({ risk, index }))
    .sort((a, b) => SEVERITY_RANK[a.risk.severity] - SEVERITY_RANK[b.risk.severity] || a.index - b.index)
    .map(({ risk }) => risk);
}

/** "src/a.ts:12-18" -> { path: "src/a.ts", line: 12 }; a ref without a line gives line null. */
export function parseFileRef(ref: string): { path: string; line: number | null } {
  const match = /^(.+?):(\d+)(?:-\d+)?$/.exec(ref);
  if (!match) return { path: ref, line: null };
  return { path: match[1]!, line: Number(match[2]) };
}
