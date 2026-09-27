import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type {
  PrMeta,
  PrDetail,
  PrAgentFindings,
  GitHubClient,
  PrReviewComment,
  SeverityCounts,
} from '@devdigest/shared';
import { PrCommentInput } from '@devdigest/shared';
import { scoreFromFindings } from '@devdigest/reviewer-core';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import {
  deriveReviewStatus,
  latestReviewPerAgent,
  rollupSeverities,
  sumRunCosts,
  sumSeverityCounts,
  SEVERITY_SORT_ORDER,
} from './status.js';
import { findingRowToDto } from '../reviews/helpers.js';

/**
 * F1 — pulls module. PR import via Octokit (list + per-PR detail).
 *   GET /repos/:id/pulls → list PRs for a repo (open + recently merged/closed,
 *                          synced from GitHub, persisted). `status` is GitHub's
 *                          merge state (open/merged/closed).
 *   GET /pulls/:id       → full PR detail (diff/files, commits, body, linked issue)
 *
 * Import is idempotent (unique repo_id+number). Review trigger is MANUAL
 * and owned by A2 — this module only imports/reads.
 */
export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req): Promise<PrMeta[]> => {
    const { workspaceId } = await getContext(container, req);
    const [repo] = await container.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, req.params.id)));
    if (!repo) throw new NotFoundError('Repo not found');

    let gh: GitHubClient | null = null;
    try {
      gh = await container.github();
    } catch (err) {
      app.log.warn({ err }, 'GitHub client unavailable (no token / offline); serving persisted PRs');
    }

    // Local-first: sync from GitHub when a token is configured, but never
    // fail the read — already-imported/seeded PRs stay viewable offline.
    if (gh) {
      try {
        const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
        for (const pr of pulls) {
          await container.db
            .insert(t.pullRequests)
            .values({
              workspaceId,
              repoId: repo.id,
              number: pr.number,
              title: pr.title,
              author: pr.author,
              branch: pr.branch,
              base: pr.base,
              headSha: pr.head_sha,
              additions: pr.additions,
              deletions: pr.deletions,
              filesCount: pr.files_count,
              status: pr.status,
              openedAt: pr.opened_at ? new Date(pr.opened_at) : null,
              updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
            })
            .onConflictDoUpdate({
              target: [t.pullRequests.repoId, t.pullRequests.number],
              set: {
                title: pr.title,
                headSha: pr.head_sha,
                status: pr.status,
                updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
              },
            });
        }
      } catch (err) {
        app.log.warn({ err }, 'GitHub PR sync skipped (no token / offline); serving persisted PRs');
      }
    }

    const rows = await container.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.repoId, repo.id));

    // Diff stats aren't on GitHub's PR-list payload, so freshly-imported PRs
    // land with zeroed size/diff. Backfill them once from the detail endpoint
    // so the list shows real S/M/L + ± counts. Capped per request (each backfill
    // is a detail fetch) — the periodic refetch chips away at any remainder.
    const BACKFILL_LIMIT = 10;
    if (gh) {
      const needStats = rows
        .filter((r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0)
        .slice(0, BACKFILL_LIMIT);
      for (const r of needStats) {
        try {
          const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, r.number);
          await container.db
            .update(t.pullRequests)
            .set({
              additions: detail.additions,
              deletions: detail.deletions,
              filesCount: detail.files_count,
            })
            .where(eq(t.pullRequests.id, r.id));
          r.additions = detail.additions;
          r.deletions = detail.deletions;
          r.filesCount = detail.files_count;
        } catch (err) {
          app.log.warn({ err, number: r.number }, 'PR diff-stat backfill skipped');
        }
      }
    }

    // The reviews behind the FINDINGS and SCORE columns: the newest review of
    // EACH agent per PR. Computed on read from reviews (no FK denorm); the list
    // is small, so a couple of IN-queries + JS grouping is cheap. No LLM call —
    // this is a plain SELECT + `Array.filter` tally. One Run Review click
    // writes one review per agent, so "newest review overall" would show only
    // whichever agent finished last — see server/specs/pr-list-findings-by-agent.md.
    const prIds = rows.map((r) => r.id);
    let agentReviewsByPr = new Map<
      string,
      { id: string; prId: string; agentId: string | null; score: number | null }[]
    >();
    if (prIds.length > 0) {
      const reviewRows = await container.db
        .select({
          id: t.reviews.id,
          prId: t.reviews.prId,
          agentId: t.reviews.agentId,
          score: t.reviews.score,
        })
        .from(t.reviews)
        .where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, 'review')))
        .orderBy(desc(t.reviews.createdAt));
      // Rows are newest-first → the first seen per (PR, agent) is its latest.
      agentReviewsByPr = latestReviewPerAgent(reviewRows);
    }

    // Agent display names for the popover's per-agent headers. One IN-query,
    // workspace-scoped; a missing entry (deleted agent, or a review with no
    // agent recorded) renders as "unknown agent" on the client.
    const agentIds = [
      ...new Set(
        [...agentReviewsByPr.values()].flat().flatMap((rv) => (rv.agentId ? [rv.agentId] : [])),
      ),
    ];
    const agentNameById = new Map<string, string>();
    if (agentIds.length > 0) {
      const agentRows = await container.db
        .select({ id: t.agents.id, name: t.agents.name })
        .from(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), inArray(t.agents.id, agentIds)));
      for (const a of agentRows) agentNameById.set(a.id, a.name);
    }

    // FINDINGS severity breakdown + read-only preview, keyed by review id.
    // One IN-query over `findings` scoped to every agent's latest review,
    // grouped in JS — same shape as the review/cost derivations either side.
    // The preview is NOT capped: it's the same scrollable-popover pattern as
    // the PR-detail Timeline (client/src/components/severity/FindingsPopover),
    // which shows every finding of a run — a review's finding count is small
    // (tens, not thousands) and text-only, so sending it all is cheap, and a
    // truncated "6 of 15" list defeats the point of a scrollable popover.
    const agentReviewIds = [...agentReviewsByPr.values()].flat().map((rv) => rv.id);
    const severityByReview = new Map<string, SeverityCounts>();
    const previewByReview = new Map<string, PrAgentFindings['findings']>();
    if (agentReviewIds.length > 0) {
      const findingRows = await container.db
        .select()
        .from(t.findings)
        .where(inArray(t.findings.reviewId, agentReviewIds));
      const byReview = new Map<string, typeof findingRows>();
      for (const f of findingRows) {
        const bucket = byReview.get(f.reviewId);
        if (bucket) bucket.push(f);
        else byReview.set(f.reviewId, [f]);
      }
      for (const [reviewId, fRows] of byReview) {
        severityByReview.set(reviewId, rollupSeverities(fRows));
        previewByReview.set(
          reviewId,
          [...fRows]
            .sort(
              (a, b) =>
                (SEVERITY_SORT_ORDER[a.severity] ?? 9) - (SEVERITY_SORT_ORDER[b.severity] ?? 9),
            )
            .map(findingRowToDto),
        );
      }
    }

    // TOTAL COST per PR for the list's cost column = the sum of EVERY
    // successful run, not just the newest one — a PR reviewed three times has
    // cost three times as much, and the list is where that adds up. Same
    // read-time derivation as the findings above (one IN-query + JS grouping, no
    // FK denorm). Only status='done' counts; null vs 0 semantics live in
    // `sumRunCosts` ("—" for unknown, never "$0.00").
    const runCostByPr = new Map<string, number | null>();
    if (prIds.length > 0) {
      const runRows = await container.db
        .select({ prId: t.agentRuns.prId, costUsd: t.agentRuns.costUsd })
        .from(t.agentRuns)
        .where(and(inArray(t.agentRuns.prId, prIds), eq(t.agentRuns.status, 'done')));
      const byPr = new Map<string, { costUsd: number | null }[]>();
      for (const run of runRows) {
        if (!run.prId) continue;
        const bucket = byPr.get(run.prId);
        if (bucket) bucket.push(run);
        else byPr.set(run.prId, [run]);
      }
      for (const [prId, runs] of byPr) runCostByPr.set(prId, sumRunCosts(runs));
    }

    const now = Date.now();
    return rows.map((r) => {
      // One group per agent (its latest review), sorted by name, unknown last.
      // A reviewed agent with zero findings still gets a zeroed group so the
      // PR-level sum below stays {0,0,0} rather than null. No reviews at all
      // (never reviewed) → null, not an empty array.
      const agentReviews = agentReviewsByPr.get(r.id);
      const agentGroups: PrAgentFindings[] | null = agentReviews
        ? agentReviews
            .map((rv) => ({
              agent_id: rv.agentId,
              agent_name: rv.agentId ? (agentNameById.get(rv.agentId) ?? null) : null,
              review_id: rv.id,
              score: rv.score,
              findings_by_severity: severityByReview.get(rv.id) ?? { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 },
              findings: previewByReview.get(rv.id) ?? [],
            }))
            .sort((a, b) => {
              if (a.agent_name == null) return b.agent_name == null ? 0 : 1;
              if (b.agent_name == null) return -1;
              return a.agent_name.localeCompare(b.agent_name);
            })
        : null;
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
        score: agentGroups ? scoreFromFindings(agentGroups.flatMap((g) => g.findings)) : null,
        cost_usd: runCostByPr.get(r.id) ?? null,
        // Summed over every agent's latest review. A reviewed PR with zero
        // findings still gets a zeroed breakdown (not null) — null means
        // "never reviewed", {0,0,0} means "reviewed, clean".
        findings_by_severity: agentGroups
          ? sumSeverityCounts(agentGroups.map((g) => g.findings_by_severity))
          : null,
        findings_by_agent: agentGroups,
      };
    });
  });

  app.get('/pulls/:id', { schema: { params: IdParams } }, async (req): Promise<PrDetail> => {
    const { workspaceId } = await getContext(container, req);
    const [pr] = await container.db
      .select()
      .from(t.pullRequests)
      .where(
        and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, req.params.id)),
      );
    if (!pr) throw new NotFoundError('Pull request not found');
    const [repo] = await container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, pr.repoId));
    if (!repo) throw new NotFoundError('Repo not found');

    // Local-first: refresh detail from GitHub when a token is configured;
    // otherwise serve the persisted files/commits/body (seeded or previously
    // imported) so PR detail works offline.
    try {
      const gh = await container.github();
      const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pr.number);

      await container.db.delete(t.prFiles).where(eq(t.prFiles.prId, pr.id));
      if (detail.files.length > 0) {
        await container.db.insert(t.prFiles).values(
          detail.files.map((f) => ({
            prId: pr.id,
            path: f.path,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch ?? null,
          })),
        );
      }
      await container.db.delete(t.prCommits).where(eq(t.prCommits.prId, pr.id));
      if (detail.commits.length > 0) {
        await container.db.insert(t.prCommits).values(
          detail.commits.map((c) => ({
            prId: pr.id,
            sha: c.sha,
            message: c.message,
            author: c.author,
            committedAt: c.committed_at ? new Date(c.committed_at) : null,
          })),
        );
      }
      await container.db
        .update(t.pullRequests)
        .set({
          body: detail.body ?? null,
          // Diff stats aren't on GitHub's PR-list payload — backfill them from
          // the detail fetch so the Pull Requests list shows real size/files.
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.files_count,
        })
        .where(eq(t.pullRequests.id, pr.id));

      return { ...detail, id: pr.id };
    } catch (err) {
      app.log.warn({ err }, 'GitHub PR detail refresh skipped (no token / offline); serving persisted detail');
      const files = await container.db.select().from(t.prFiles).where(eq(t.prFiles.prId, pr.id));
      const commits = await container.db.select().from(t.prCommits).where(eq(t.prCommits.prId, pr.id));
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
  });

  // ---- Inline review comments (Files changed tab) -------------------------
  // Proxied live to GitHub (no local persistence): GET reflects existing PR
  // comments; POST creates one immediately. Keeps the tab in lock-step with
  // GitHub and avoids a stale local mirror.
  async function resolvePrAndRepo(id: string, workspaceId: string) {
    const [pr] = await container.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, id)));
    if (!pr) throw new NotFoundError('Pull request not found');
    const [repo] = await container.db.select().from(t.repos).where(eq(t.repos.id, pr.repoId));
    if (!repo) throw new NotFoundError('Repo not found');
    return { pr, repo };
  }

  app.get(
    '/pulls/:id/comments',
    { schema: { params: IdParams } },
    async (req): Promise<PrReviewComment[]> => {
      const { workspaceId } = await getContext(container, req);
      const { pr, repo } = await resolvePrAndRepo(req.params.id, workspaceId);
      let gh: GitHubClient;
      try {
        gh = await container.github();
      } catch (err) {
        app.log.warn({ err }, 'GitHub client unavailable; serving no PR comments');
        return [];
      }
      try {
        return await gh.listReviewComments({ owner: repo.owner, name: repo.name }, pr.number);
      } catch (err) {
        app.log.warn({ err }, 'GitHub review-comments fetch skipped (offline / error)');
        return [];
      }
    },
  );

  app.post(
    '/pulls/:id/comments',
    { schema: { params: IdParams, body: PrCommentInput } },
    async (req): Promise<PrReviewComment> => {
      const { workspaceId } = await getContext(container, req);
      const { pr, repo } = await resolvePrAndRepo(req.params.id, workspaceId);
      const input = req.body;
      let gh: GitHubClient;
      try {
        gh = await container.github();
      } catch {
        throw new AppError(
          'github_unavailable',
          'Connect a GitHub token to post comments.',
          400,
        );
      }
      try {
        return await gh.createReviewComment({ owner: repo.owner, name: repo.name }, pr.number, {
          commitId: pr.headSha,
          path: input.path,
          line: input.line,
          ...(input.side ? { side: input.side } : {}),
          body: input.body,
          ...(input.in_reply_to != null ? { inReplyTo: input.in_reply_to } : {}),
        });
      } catch (err) {
        // GitHub rejects comments on lines outside the diff / on closed PRs (422).
        const msg = err instanceof Error ? err.message : 'Failed to post the comment to GitHub.';
        throw new AppError('github_comment_failed', msg, 400, { cause: String(err) });
      }
    },
  );
}
