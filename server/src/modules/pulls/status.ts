import type { PrStatus, SeverityCounts } from '@devdigest/shared';

/**
 * PR-list rollup helpers (pure — no DB / `this`, so they unit-test cleanly).
 *
 * The Pull Requests list shows, per PR: the latest review's SCORE, a FINDINGS
 * severity breakdown, and a review STATUS. The DB `status` column holds
 * GitHub's merge state (open/merged/closed); the review status
 * (needs_review / reviewed / stale) is DERIVED here for OPEN PRs from the
 * commit a review last ran against (`lastReviewedSha`) vs the PR head, plus age.
 */

/** Open PRs whose current head was reviewed but untouched this long read "stale". */
export const STALE_DAYS = 7;

/** Sort weight for the popover preview — most severe first. */
export const SEVERITY_SORT_ORDER: Record<string, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

/** Keys match the wire `Severity` enum so callers can index it directly with
 *  a finding's `severity` field. Re-exported from the wire contract so the
 *  route's rollups and the `PrMeta` fields can't drift apart. */
export type { SeverityCounts };

/**
 * Total spend for one PR = the SUM of every successful run's cost.
 *
 * Callers pass only `status='done'` rows: a failed run has no meaningful spend
 * to surface. Null handling is the point of this helper —
 *  - no rows at all (never reviewed)      → `null` → the column renders "—"
 *  - rows exist but every cost is null    → `null` (price unknown, NOT free)
 *  - at least one row is priced           → the sum of the priced ones
 * `null` never degrades to `0`, because "$0.00" would claim the run was free.
 */
export function sumRunCosts(rows: { costUsd: number | null }[]): number | null {
  let total: number | null = null;
  for (const r of rows) {
    if (r.costUsd == null) continue;
    total = (total ?? 0) + r.costUsd;
  }
  return total;
}

/** Tally finding severities (CRITICAL / WARNING / SUGGESTION) for one review. */
export function rollupSeverities(rows: { severity: string }[]): SeverityCounts {
  const c: SeverityCounts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const r of rows) {
    if (r.severity === 'CRITICAL') c.CRITICAL += 1;
    else if (r.severity === 'WARNING') c.WARNING += 1;
    else if (r.severity === 'SUGGESTION') c.SUGGESTION += 1;
  }
  return c;
}

/** Sum several severity tallies (one per agent) into one. Empty → all zeros. */
export function sumSeverityCounts(counts: SeverityCounts[]): SeverityCounts {
  const c: SeverityCounts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const x of counts) {
    c.CRITICAL += x.CRITICAL;
    c.WARNING += x.WARNING;
    c.SUGGESTION += x.SUGGESTION;
  }
  return c;
}

/**
 * The reviews that feed a PR's FINDINGS column: the LATEST review of EACH
 * agent. A re-run of the same agent replaces its previous review rather than
 * adding to it, so retries don't inflate the count.
 *
 * `rowsNewestFirst` MUST be ordered newest-first (the caller's ORDER BY) —
 * the first row seen per `(prId, agentId)` wins. Reviews with a null
 * `agentId` (legacy / seeded rows) share one "unattributed" bucket per PR.
 * Returns each PR's winners in the same newest-first order.
 */
export function latestReviewPerAgent<T extends { prId: string; agentId: string | null }>(
  rowsNewestFirst: T[],
): Map<string, T[]> {
  const seen = new Set<string>();
  const byPr = new Map<string, T[]>();
  for (const row of rowsNewestFirst) {
    // JSON-encoded tuple: no separator can collide with a real id, and null
    // stays distinct from any string agent id.
    const key = JSON.stringify([row.prId, row.agentId]);
    if (seen.has(key)) continue;
    seen.add(key);
    const bucket = byPr.get(row.prId);
    if (bucket) bucket.push(row);
    else byPr.set(row.prId, [row]);
  }
  return byPr;
}

/**
 * Review-freshness status for the PR list. Merged/closed PRs keep their GitHub
 * merge state; open PRs map to:
 *  - `needs_review` — never reviewed, OR head moved since the last review
 *  - `stale`        — current head was reviewed but the PR is older than STALE_DAYS
 *  - `reviewed`     — current head reviewed and recent
 */
export function deriveReviewStatus(args: {
  /** DB `status` column = GitHub merge state (open/merged/closed). */
  ghStatus: string;
  lastReviewedSha: string | null;
  headSha: string;
  updatedAt: Date | null;
  now: number;
  staleDays?: number;
}): PrStatus {
  const { ghStatus, lastReviewedSha, headSha, updatedAt, now } = args;
  if (ghStatus === 'merged' || ghStatus === 'closed') return ghStatus as PrStatus;
  if (!lastReviewedSha || lastReviewedSha !== headSha) return 'needs_review';
  const staleMs = (args.staleDays ?? STALE_DAYS) * 86_400_000;
  if (updatedAt && now - updatedAt.getTime() > staleMs) return 'stale';
  return 'reviewed';
}
