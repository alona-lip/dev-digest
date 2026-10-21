/**
 * Pure helpers for the pulls module: row → wire DTO assembly for the PR list
 * and PR detail. No I/O — the service loads the rows, these decide the shape.
 * The rollup rules themselves (latest review per agent, severity counts, cost
 * sum, review status) live in `status.ts`.
 */
import type { PrAgentFindings, PrDetail, PrMeta, SeverityCounts } from '@devdigest/shared';
import { scoreFromFindings } from '@devdigest/reviewer-core';
import type { FindingRow, PrCommitRow, PrFileRow, PullRow } from '../../db/rows.js';
import { findingRowToDto } from '../_shared/findings.js';
import { rollupSeverities, sumSeverityCounts, deriveReviewStatus, SEVERITY_SORT_ORDER } from './status.js';

/** Max PRs whose zeroed diff stats are backfilled from GitHub per list request. */
export const DIFF_STATS_BACKFILL_LIMIT = 10;

const ZERO_COUNTS: SeverityCounts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };

/** PRs imported from GitHub's list payload, which carries no diff stats yet. */
export function needsDiffStats(rows: PullRow[]): PullRow[] {
  return rows
    .filter((r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0)
    .slice(0, DIFF_STATS_BACKFILL_LIMIT);
}

/**
 * Per review: its severity breakdown and the popover preview (most severe
 * first). The preview is NOT capped — same scrollable popover as the PR-detail
 * Timeline; a "6 of 15" truncation reads as broken (INSIGHTS 2026-09-21).
 */
export function findingsByReview(rows: FindingRow[]): {
  severity: Map<string, SeverityCounts>;
  preview: Map<string, PrAgentFindings['findings']>;
} {
  const grouped = new Map<string, FindingRow[]>();
  for (const f of rows) {
    const bucket = grouped.get(f.reviewId);
    if (bucket) bucket.push(f);
    else grouped.set(f.reviewId, [f]);
  }
  const severity = new Map<string, SeverityCounts>();
  const preview = new Map<string, PrAgentFindings['findings']>();
  for (const [reviewId, fRows] of grouped) {
    severity.set(reviewId, rollupSeverities(fRows));
    preview.set(
      reviewId,
      [...fRows]
        .sort(
          (a, b) => (SEVERITY_SORT_ORDER[a.severity] ?? 9) - (SEVERITY_SORT_ORDER[b.severity] ?? 9),
        )
        .map(findingRowToDto),
    );
  }
  return { severity, preview };
}

/** Group run costs by PR id (rows without a PR are skipped). */
export function runCostsByPr<T extends { prId: string | null }>(rows: T[]): Map<string, T[]> {
  const byPr = new Map<string, T[]>();
  for (const run of rows) {
    if (!run.prId) continue;
    const bucket = byPr.get(run.prId);
    if (bucket) bucket.push(run);
    else byPr.set(run.prId, [run]);
  }
  return byPr;
}

/**
 * One group per agent (its latest review), sorted by name, unknown agent last.
 * A reviewed agent with zero findings still gets a zeroed group so the PR-level
 * sum stays {0,0,0} rather than null. Never reviewed → null, not [].
 */
export function agentGroups(
  agentReviews: { id: string; agentId: string | null; score: number | null }[] | undefined,
  agentNameById: Map<string, string>,
  findings: ReturnType<typeof findingsByReview>,
): PrAgentFindings[] | null {
  if (!agentReviews) return null;
  return agentReviews
    .map((rv) => ({
      agent_id: rv.agentId,
      agent_name: rv.agentId ? (agentNameById.get(rv.agentId) ?? null) : null,
      review_id: rv.id,
      score: rv.score,
      findings_by_severity: findings.severity.get(rv.id) ?? { ...ZERO_COUNTS },
      findings: findings.preview.get(rv.id) ?? [],
    }))
    .sort((a, b) => {
      if (a.agent_name == null) return b.agent_name == null ? 0 : 1;
      if (b.agent_name == null) return -1;
      return a.agent_name.localeCompare(b.agent_name);
    });
}

/** A PR-list row. */
export function toPrMeta(
  r: PullRow,
  groups: PrAgentFindings[] | null,
  costUsd: number | null,
  now: number,
): PrMeta {
  return {
    id: r.id,
    number: r.number,
    title: r.title,
    author: r.author,
    branch: r.branch,
    base: r.base,
    head_sha: r.headSha,
    additions: r.additions,
    deletions: r.deletions,
    files_count: r.filesCount,
    status: deriveReviewStatus({
      ghStatus: r.status,
      lastReviewedSha: r.lastReviewedSha,
      headSha: r.headSha,
      updatedAt: r.updatedAt,
      now,
    }),
    opened_at: r.openedAt?.toISOString() ?? null,
    updated_at: r.updatedAt?.toISOString() ?? null,
    // Recomputed from exactly the findings the FINDINGS column counts, with
    // the engine's own rule (100 − 35·C − 12·W − 3·S, clamped) — the score
    // can never contradict the pills beside it (Field Manual, Sheet 05).
    // NOT any single agent's `reviews.score`, and NOT a mean of them.
    score: groups ? scoreFromFindings(groups.flatMap((g) => g.findings)) : null,
    cost_usd: costUsd,
    // Summed over every agent's latest review. A reviewed PR with zero
    // findings still gets a zeroed breakdown (not null) — null means
    // "never reviewed", {0,0,0} means "reviewed, clean".
    findings_by_severity: groups ? sumSeverityCounts(groups.map((g) => g.findings_by_severity)) : null,
    findings_by_agent: groups,
  };
}

/** PR detail served from what is persisted (offline / no GitHub token). */
export function toPersistedPrDetail(
  pr: PullRow,
  files: PrFileRow[],
  commits: PrCommitRow[],
): PrDetail {
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    author: pr.author,
    branch: pr.branch,
    base: pr.base,
    head_sha: pr.headSha,
    additions: pr.additions,
    deletions: pr.deletions,
    files_count: pr.filesCount,
    status: pr.status as PrDetail['status'],
    opened_at: pr.openedAt?.toISOString() ?? null,
    updated_at: pr.updatedAt?.toISOString() ?? null,
    body: pr.body ?? null,
    files: files.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ?? null,
    })),
    commits: commits.map((c) => ({
      sha: c.sha,
      message: c.message,
      author: c.author,
      committed_at: c.committedAt?.toISOString() ?? null,
    })),
  };
}
