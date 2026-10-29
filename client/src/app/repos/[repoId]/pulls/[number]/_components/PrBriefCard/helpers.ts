import type { BriefResponse, ReviewRecord, RunSummary, Verdict } from "@devdigest/shared";
import { countBlockers } from "../../helpers";

export interface LatestBrief {
  review: ReviewRecord;
  verdict: Verdict;
  /** Open CRITICAL findings (`countBlockers`, shared with the Findings tab's run accordion). */
  blockers: number;
  /** The run that produced the review (cost, tokens); null when it is not in the run list. */
  run: RunSummary | null;
}

/** The newest review with a verdict (reviews arrive newest-first) and its run, or null. */
export function pickLatestBrief(
  reviews: ReviewRecord[] | undefined,
  runs: RunSummary[] | undefined,
): LatestBrief | null {
  const review = reviews?.find((r) => r.kind === "review" && r.verdict != null);
  if (!review?.verdict) return null;
  return {
    review,
    verdict: review.verdict,
    blockers: countBlockers(review.findings),
    run: runs?.find((r) => r.run_id === review.run_id) ?? null,
  };
}

export interface MissingEntry {
  input: string;
  reason: string;
}

/** Upper-cases the first letter ("intent" -> "Intent") for the "Generated without:" note. */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type ReadyBrief = Extract<BriefResponse, { status: "ready" }>;

/** The `ready` arm of a brief response, or null for `none` / not loaded. */
export function pickReady(data: BriefResponse | undefined): ReadyBrief | null {
  return data?.status === "ready" ? data : null;
}
