/**
 * Picking a review and shaping its findings for a tool reply. `shapeFindings`
 * is pure; `loadReview` reads reviews/runs through the client.
 */
import type { ReviewRecord, Severity, SeverityCounts } from '@devdigest/shared';
import type { DevDigestClient } from '../http/client.js';
import { compactFinding, detailedFinding, type CompactFinding, type DetailedFinding } from '../format.js';

const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

export type ResponseFormat = 'concise' | 'detailed';

export type FindingsPage = {
  run_id: string | null;
  agent: string | null;
  verdict: ReviewRecord['verdict'];
  score: number | null;
  summary: string | null;
  /** Over ALL findings of the review, before paging. */
  counts: SeverityCounts;
  total: number;
  returned: number;
  offset: number;
  findings: CompactFinding[] | DetailedFinding[];
};

/** Worst first; ties keep the order the review stored them in. */
export function shapeFindings(
  review: ReviewRecord,
  opts: { format: ResponseFormat; offset: number; limit: number },
): FindingsPage {
  const all = review.findings;
  const counts: SeverityCounts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of all) counts[f.severity] += 1;

  const page = [...all]
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(opts.offset, opts.offset + opts.limit);

  return {
    run_id: review.run_id,
    agent: review.agent_name ?? null,
    verdict: review.verdict,
    score: review.score,
    summary: review.summary,
    counts,
    total: all.length,
    returned: page.length,
    offset: opts.offset,
    findings: opts.format === 'detailed' ? page.map(detailedFinding) : page.map(compactFinding),
  };
}

export type LoadedReview =
  | { kind: 'review'; review: ReviewRecord }
  | { kind: 'running'; run_id: string }
  | { kind: 'missing'; error: string };

/**
 * The review for `runId`, or the newest `kind:'review'` row of the PR. No
 * silent fallback: an unknown `runId` is reported, never swapped for another
 * run's findings. A run that has no review yet is looked up in the run list
 * so "still running" and "failed" are told apart.
 */
export async function loadReview(
  client: DevDigestClient,
  pullId: string,
  runId?: string,
): Promise<LoadedReview> {
  const reviews = (await client.listReviews(pullId)).filter((r) => r.kind === 'review');

  if (runId === undefined) {
    const newest = [...reviews].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (newest) return { kind: 'review', review: newest };
    return { kind: 'missing', error: 'This PR has no completed review yet. Call run_agent_on_pr first.' };
  }

  const exact = reviews.find((r) => r.run_id === runId);
  if (exact) return { kind: 'review', review: exact };

  const run = (await client.listRuns(pullId)).find((r) => r.run_id === runId);
  if (run && (run.status === null || run.status === 'running')) return { kind: 'running', run_id: runId };
  if (run && (run.status === 'failed' || run.status === 'cancelled')) {
    return {
      kind: 'missing',
      error: `Run ${runId} ${run.status}${run.error ? `: ${run.error}` : ''}. Start a new one with run_agent_on_pr.`,
    };
  }

  const known = reviews.map((r) => r.run_id).filter(Boolean);
  const hint = known.length > 0 ? ` Runs with reviews on this PR: ${known.join(', ')}.` : '';
  return {
    kind: 'missing',
    error: `Run ${runId} is not a run of this PR.${hint} Omit run_id to get the latest review.`,
  };
}
