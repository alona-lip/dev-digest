import { and, desc, eq, inArray } from 'drizzle-orm';
import type { PrDetail, PrMeta } from '@devdigest/shared';
import type { Executor } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { FindingRow, PrCommitRow, PrFileRow, PullRow, RepoRow } from '../../db/rows.js';

/**
 * Pulls data access — the ONLY layer touching `pull_requests`, `pr_files` and
 * `pr_commits` for this module, plus the read-only rollup inputs the PR list
 * needs (`reviews`, `findings`, `agent_runs`, agent names). Every read a user
 * can reach is scoped by `workspaceId`; the decisions about what the numbers
 * mean live in `status.ts` / `helpers.ts`, not here.
 *
 * Shared with `polling` through `container.pullsRepo` (no cross-module import).
 */

/** The per-agent review row the PR-list rollups start from. */
export interface AgentReviewRow {
  id: string;
  prId: string;
  agentId: string | null;
  score: number | null;
}

export interface DiffStats {
  additions: number;
  deletions: number;
  filesCount: number;
}

export class PullsRepository {
  constructor(private db: Executor) {}

  /** Run `fn` inside one transaction; on a Tx this nests as a savepoint. */
  inTransaction<T>(fn: (repo: PullsRepository) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(new PullsRepository(tx)));
  }

  // ---- repos / PRs (workspace-scoped) -------------------------------------

  async getRepo(workspaceId: string, repoId: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  /**
   * The repo a PR belongs to. Unscoped by design: callers reach it only
   * through a PR they already loaded with `getPull(workspaceId, …)`.
   */
  async getRepoOfPull(pull: PullRow): Promise<RepoRow | undefined> {
    const [row] = await this.db.select().from(t.repos).where(eq(t.repos.id, pull.repoId));
    return row;
  }

  listForRepo(repoId: string): Promise<PullRow[]> {
    return this.db.select().from(t.pullRequests).where(eq(t.pullRequests.repoId, repoId));
  }

  /**
   * Upsert GitHub's PR list into `pull_requests` (idempotent on
   * repo_id+number). The ONE projection of a GitHub PR onto a row — the list
   * route and `polling` used to carry their own copies, and the polling one
   * had silently dropped `opened_at`. Returns how many PRs were written.
   */
  async upsertFromGitHub(workspaceId: string, repoId: string, pulls: PrMeta[]): Promise<number> {
    for (const pr of pulls) {
      const updatedAt = pr.updated_at ? new Date(pr.updated_at) : null;
      await this.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
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
          updatedAt,
        })
        .onConflictDoUpdate({
          target: [t.pullRequests.repoId, t.pullRequests.number],
          set: { title: pr.title, headSha: pr.head_sha, status: pr.status, updatedAt },
        });
    }
    return pulls.length;
  }

  async setDiffStats(prId: string, stats: DiffStats): Promise<void> {
    await this.db.update(t.pullRequests).set(stats).where(eq(t.pullRequests.id, prId));
  }

  async markPolled(repoId: string): Promise<void> {
    await this.db.update(t.repos).set({ lastPolledAt: new Date() }).where(eq(t.repos.id, repoId));
  }

  // ---- PR detail: files + commits -----------------------------------------

  async filesAndCommits(prId: string): Promise<{ files: PrFileRow[]; commits: PrCommitRow[] }> {
    const files = await this.db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
    const commits = await this.db.select().from(t.prCommits).where(eq(t.prCommits.prId, prId));
    return { files, commits };
  }

  /**
   * Replace a PR's persisted files/commits and body + diff stats with a fresh
   * GitHub detail — in ONE transaction. Done as separate statements, a failure
   * after the deletes left the PR with no files, which the offline fallback
   * then served as an empty diff.
   */
  replaceDetail(prId: string, detail: PrDetail): Promise<void> {
    return this.inTransaction(async ({ db }) => {
      await db.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
      if (detail.files.length > 0) {
        await db.insert(t.prFiles).values(
          detail.files.map((f) => ({
            prId,
            path: f.path,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch ?? null,
          })),
        );
      }
      await db.delete(t.prCommits).where(eq(t.prCommits.prId, prId));
      if (detail.commits.length > 0) {
        await db.insert(t.prCommits).values(
          detail.commits.map((c) => ({
            prId,
            sha: c.sha,
            message: c.message,
            author: c.author,
            committedAt: c.committed_at ? new Date(c.committed_at) : null,
          })),
        );
      }
      await db
        .update(t.pullRequests)
        .set({
          body: detail.body ?? null,
          // Diff stats aren't on GitHub's PR-list payload — backfill them from
          // the detail fetch so the Pull Requests list shows real size/files.
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.files_count,
        })
        .where(eq(t.pullRequests.id, prId));
    });
  }

  // ---- PR-list rollup inputs (read-only) ----------------------------------

  /** `kind='review'` rows for these PRs, NEWEST FIRST (callers pick "latest per agent"). */
  reviewsNewestFirst(prIds: string[]): Promise<AgentReviewRow[]> {
    if (prIds.length === 0) return Promise.resolve([]);
    return this.db
      .select({
        id: t.reviews.id,
        prId: t.reviews.prId,
        agentId: t.reviews.agentId,
        score: t.reviews.score,
      })
      .from(t.reviews)
      .where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, 'review')))
      .orderBy(desc(t.reviews.createdAt));
  }

  /** Display names of these agents within the workspace; a missing id simply isn't in the map. */
  async agentNames(workspaceId: string, agentIds: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (agentIds.length === 0) return names;
    const rows = await this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), inArray(t.agents.id, agentIds)));
    for (const a of rows) names.set(a.id, a.name);
    return names;
  }

  findingsForReviews(reviewIds: string[]): Promise<FindingRow[]> {
    if (reviewIds.length === 0) return Promise.resolve([]);
    return this.db.select().from(t.findings).where(inArray(t.findings.reviewId, reviewIds));
  }

  /** Cost of every SUCCESSFUL (`status='done'`) run of these PRs. */
  doneRunCosts(prIds: string[]): Promise<{ prId: string | null; costUsd: number | null }[]> {
    if (prIds.length === 0) return Promise.resolve([]);
    return this.db
      .select({ prId: t.agentRuns.prId, costUsd: t.agentRuns.costUsd })
      .from(t.agentRuns)
      .where(and(inArray(t.agentRuns.prId, prIds), eq(t.agentRuns.status, 'done')));
  }
}
