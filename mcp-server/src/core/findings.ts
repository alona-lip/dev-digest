/**
 * Picking reviews and shaping their findings for a tool reply. `shapeFindings`
 * and `shapeReviews` are pure; `loadReviews` reads reviews/runs through the client.
 */
import type { AgentListItem, ReviewRecord, Severity, SeverityCounts } from '@devdigest/shared';
import type { DevDigestClient } from '../http/client.js';
import { compactFinding, detailedFinding, type CompactFinding, type DetailedFinding } from '../format.js';

const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

export type ResponseFormat = 'concise' | 'detailed';

/** One review with one page of its findings. */
export type ReviewPage = {
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
): ReviewPage {
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

/** `get_findings` reply: each review keeps its own findings; `total_findings` sums them before paging. */
export type ReviewsPage = {
  total_findings: number;
  reviews: ReviewPage[];
};

/** Order is kept as given (`loadReviews` returns newest first); paging applies per review. */
export function shapeReviews(
  reviews: ReviewRecord[],
  opts: { format: ResponseFormat; offset: number; limit: number },
): ReviewsPage {
  const pages = reviews.map((r) => shapeFindings(r, opts));
  return { total_findings: pages.reduce((n, p) => n + p.total, 0), reviews: pages };
}

export type LoadedReviews =
  | { kind: 'reviews'; reviews: ReviewRecord[] }
  | { kind: 'running'; run_id: string }
  | { kind: 'missing'; error: string };

export type ReviewQuery = {
  runId?: string;
  /** Only reviews by this agent (already resolved from list_agents). */
  agent?: Pick<AgentListItem, 'id' | 'name'>;
  /** Every completed review instead of the newest one. */
  allRuns?: boolean;
};

/**
 * Without `runId`: the newest `kind:'review'` row of the PR (of `agent`, if
 * given), or all of them newest first with `allRuns`. With `runId`: exactly
 * that run. No silent fallback: an unknown `runId` is reported, never swapped
 * for another run's findings. A run that has no review yet is looked up in the
 * run list so "still running" and "failed" are told apart.
 */
export async function loadReviews(
  client: DevDigestClient,
  pullId: string,
  query: ReviewQuery = {},
): Promise<LoadedReviews> {
  const { runId, agent, allRuns = false } = query;
  if (runId !== undefined && allRuns) {
    return { kind: 'missing', error: 'Pass either run_id (one run) or all_runs: true (every run), not both.' };
  }

  const reviews = (await client.listReviews(pullId)).filter((r) => r.kind === 'review');

  if (runId === undefined) {
    const scoped = (agent ? reviews.filter((r) => r.agent_id === agent.id) : reviews).sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
    if (scoped.length > 0) return { kind: 'reviews', reviews: allRuns ? scoped : scoped.slice(0, 1) };
    const error = agent
      ? `Agent '${agent.name}' has no completed review on this PR. Call run_agent_on_pr with agent '${agent.id}' first.`
      : 'This PR has no completed review yet. Call run_agent_on_pr first.';
    return { kind: 'missing', error };
  }

  const exact = reviews.find((r) => r.run_id === runId);
  if (exact) {
    if (agent && exact.agent_id !== agent.id) return otherAgent(runId, exact.agent_name ?? exact.agent_id, agent);
    return { kind: 'reviews', reviews: [exact] };
  }

  const run = (await client.listRuns(pullId)).find((r) => r.run_id === runId);
  if (run && agent && run.agent_id !== agent.id) return otherAgent(runId, run.agent_name, agent);
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

function otherAgent(runId: string, owner: string | null, agent: Pick<AgentListItem, 'name'>): LoadedReviews {
  return {
    kind: 'missing',
    error: `Run ${runId} belongs to '${owner ?? 'another agent'}', not '${agent.name}'. Drop agent or run_id.`,
  };
}
