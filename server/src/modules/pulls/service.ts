import type {
  GitHubClient,
  PrCommentInput,
  PrDetail,
  PrMeta,
  PrReviewComment,
} from '@devdigest/shared';
import type { PullRow, RepoRow } from '../../db/rows.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { PullsRepository } from './repository.js';
import { latestReviewPerAgent, sumRunCosts } from './status.js';
import {
  agentGroups,
  findingsByReview,
  needsDiffStats,
  runCostsByPr,
  toPersistedPrDetail,
  toPrMeta,
} from './helpers.js';

/** The slice of a pino logger the service needs (Fastify's `app.log` fits). */
export interface WarnLogger {
  warn(obj: unknown, msg?: string): void;
}

/**
 * Pulls use cases: PR import/list via GitHub (local-first — a missing token or
 * an offline GitHub never fails a read), PR detail, and the live-proxied inline
 * review comments. Review triggering is NOT here (manual, owned by `reviews`).
 *
 * Dependencies are injected narrowly: the repository, a lazy GitHub port (the
 * token is a secret resolved on first use) and a logger.
 */
export class PullsService {
  constructor(
    private readonly repo: PullsRepository,
    private readonly github: () => Promise<GitHubClient>,
    private readonly log: WarnLogger,
  ) {}

  /** The GitHub client, or null when no token is configured / it can't be built. */
  private async githubOrNull(context: string): Promise<GitHubClient | null> {
    try {
      return await this.github();
    } catch (err) {
      this.log.warn({ err }, `GitHub client unavailable (no token / offline); ${context}`);
      return null;
    }
  }

  private async pullWithRepo(workspaceId: string, prId: string): Promise<{ pr: PullRow; repo: RepoRow }> {
    const pr = await this.repo.getPull(workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepoOfPull(pr);
    if (!repo) throw new NotFoundError('Repo not found');
    return { pr, repo };
  }

  /**
   * GET /repos/:id/pulls — sync from GitHub when possible, then serve the
   * persisted PRs with their per-agent FINDINGS / SCORE / COST rollups.
   */
  async listForRepo(workspaceId: string, repoId: string): Promise<PrMeta[]> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    const ref = { owner: repo.owner, name: repo.name };

    const gh = await this.githubOrNull('serving persisted PRs');
    if (gh) {
      try {
        await this.repo.upsertFromGitHub(workspaceId, repo.id, await gh.listPullRequests(ref));
      } catch (err) {
        this.log.warn({ err }, 'GitHub PR sync skipped (no token / offline); serving persisted PRs');
      }
    }

    const rows = await this.repo.listForRepo(repo.id);

    // Diff stats aren't on GitHub's PR-list payload, so freshly-imported PRs
    // land zeroed. Backfill a capped number per request from the detail
    // endpoint; the periodic refetch chips away at any remainder.
    if (gh) {
      for (const r of needsDiffStats(rows)) {
        try {
          const detail = await gh.getPullRequest(ref, r.number);
          const stats = {
            additions: detail.additions,
            deletions: detail.deletions,
            filesCount: detail.files_count,
          };
          await this.repo.setDiffStats(r.id, stats);
          Object.assign(r, stats);
        } catch (err) {
          this.log.warn({ err, number: r.number }, 'PR diff-stat backfill skipped');
        }
      }
    }

    // FINDINGS / SCORE come from the newest review of EACH agent per PR — one
    // Run Review click writes one review per agent, so "newest review overall"
    // would show only whichever agent finished last
    // (server/specs/pr-list-findings-by-agent.md). Read-time IN-queries + pure
    // grouping; no LLM call, no FK denorm.
    const prIds = rows.map((r) => r.id);
    const agentReviewsByPr = latestReviewPerAgent(await this.repo.reviewsNewestFirst(prIds));
    const latestReviews = [...agentReviewsByPr.values()].flat();
    const agentIds = [...new Set(latestReviews.flatMap((rv) => (rv.agentId ? [rv.agentId] : [])))];
    const agentNameById = await this.repo.agentNames(workspaceId, agentIds);
    const findings = findingsByReview(
      await this.repo.findingsForReviews(latestReviews.map((rv) => rv.id)),
    );

    // TOTAL COST per PR = the sum of EVERY successful run, not just the newest
    // one; null-vs-zero semantics live in `sumRunCosts` ("—", never "$0.00").
    const costRowsByPr = runCostsByPr(await this.repo.doneRunCosts(prIds));

    const now = Date.now();
    return rows.map((r) => {
      const costRows = costRowsByPr.get(r.id);
      return toPrMeta(
        r,
        agentGroups(agentReviewsByPr.get(r.id), agentNameById, findings),
        costRows ? sumRunCosts(costRows) : null,
        now,
      );
    });
  }

  /**
   * GET /pulls/:id — refresh detail from GitHub when a token is configured;
   * otherwise (or on any failure) serve the persisted files/commits/body so PR
   * detail works offline.
   */
  async detail(workspaceId: string, prId: string): Promise<PrDetail> {
    const { pr, repo } = await this.pullWithRepo(workspaceId, prId);
    try {
      const gh = await this.github();
      const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pr.number);
      await this.repo.replaceDetail(pr.id, detail);
      return { ...detail, id: pr.id };
    } catch (err) {
      this.log.warn(
        { err },
        'GitHub PR detail refresh skipped (no token / offline); serving persisted detail',
      );
      const { files, commits } = await this.repo.filesAndCommits(pr.id);
      return toPersistedPrDetail(pr, files, commits);
    }
  }

  /**
   * Inline review comments are proxied live to GitHub (no local mirror):
   * without a token, or when GitHub fails, the tab simply shows none.
   */
  async listComments(workspaceId: string, prId: string): Promise<PrReviewComment[]> {
    const { pr, repo } = await this.pullWithRepo(workspaceId, prId);
    const gh = await this.githubOrNull('serving no PR comments');
    if (!gh) return [];
    try {
      return await gh.listReviewComments({ owner: repo.owner, name: repo.name }, pr.number);
    } catch (err) {
      this.log.warn({ err }, 'GitHub review-comments fetch skipped (offline / error)');
      return [];
    }
  }

  async postComment(
    workspaceId: string,
    prId: string,
    input: PrCommentInput,
  ): Promise<PrReviewComment> {
    const { pr, repo } = await this.pullWithRepo(workspaceId, prId);
    let gh: GitHubClient;
    try {
      gh = await this.github();
    } catch {
      throw new AppError('github_unavailable', 'Connect a GitHub token to post comments.', 400);
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
  }
}
