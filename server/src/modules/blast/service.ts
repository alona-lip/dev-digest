import { PrBlastRadius } from '@devdigest/shared';
import type { PullRow, RepoRow } from '../../db/rows.js';
import type { Container } from '../../platform/container.js';
import { ExternalServiceError, NotFoundError } from '../../platform/errors.js';
import type { RepoIntel } from '../repo-intel/index.js';
import { loadDiff, type ReviewRepository } from '../reviews/index.js';
import { buildSummary, countBlast, toBlastRadius } from './helpers.js';

/** Where progress goes: the request logger (routes adapt pino's `(obj, msg)` to this). */
export interface BlastLog {
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
}

/** The collaborators the service uses — narrow, so tests can fake each one. */
export interface BlastDeps {
  reviews: Pick<ReviewRepository, 'getPull' | 'getRepo'>;
  /** Paths of the local diff: `git diff base...head`, else the persisted `pr_files`. */
  diffFiles(workspaceId: string, pull: PullRow, repo: RepoRow): Promise<string[]>;
  /** The PR's file list from GitHub (one API call, no persistence). Throws when unreachable / no token. */
  githubFiles(pull: PullRow, repo: RepoRow): Promise<string[]>;
  repoIntel: Pick<RepoIntel, 'getBlastRadius'>;
}

/** What the container exposes and what routes call — tests fake exactly this. */
export type BlastPort = Pick<BlastService, 'forPull'>;

/** Blast radius of a PR: a pure read of the repo-intel index. No LLM call. */
export class BlastService {
  constructor(private readonly deps: BlastDeps) {}

  async forPull(workspaceId: string, prId: string, log?: BlastLog): Promise<PrBlastRadius> {
    const { pull, repo } = await this.load(workspaceId, prId);
    const paths = await this.changedFiles(workspaceId, pull, repo, log);
    const r = await this.deps.repoIntel.getBlastRadius(pull.repoId, paths);

    const degraded = r.degraded ?? false;
    const reason = degraded ? (r.reason ?? 'no_data') : null;
    const blast = toBlastRadius(r);
    const counts = countBlast(blast);

    log?.info('blast: read from index', {
      changedFiles: paths.length,
      changedSymbols: counts.symbols,
      callers: counts.callers,
      endpoints: counts.endpoints,
      crons: counts.crons,
      degraded,
      reason,
    });

    return PrBlastRadius.parse({
      ...blast,
      summary: buildSummary(counts, degraded, reason),
      pr_id: pull.id,
      degraded,
      reason,
    });
  }

  /**
   * Changed paths, cheapest source first. The local diff alone is not enough: a
   * fork PR's head is not in the clone and `pr_files` is only filled when someone
   * opens PR detail, so an empty diff falls back to GitHub. If GitHub fails too,
   * the answer is unknown — say so (502) instead of a healthy "nothing changed".
   */
  private async changedFiles(
    workspaceId: string,
    pull: PullRow,
    repo: RepoRow,
    log?: BlastLog,
  ): Promise<string[]> {
    const local = await this.deps.diffFiles(workspaceId, pull, repo);
    if (local.length > 0) return local;
    try {
      return await this.deps.githubFiles(pull, repo);
    } catch (err) {
      log?.warn('blast: changed files unavailable (empty local diff, GitHub lookup failed)', { err });
      throw new ExternalServiceError(
        "Could not determine this PR's changed files: there is no local diff and GitHub did not answer. " +
          'Check the GitHub token in Settings, then retry.',
      );
    }
  }

  private async load(workspaceId: string, prId: string): Promise<{ pull: PullRow; repo: RepoRow }> {
    const pull = await this.deps.reviews.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.deps.reviews.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return { pull, repo };
  }
}

/** Composition: wire the service to the container's repository and the repo-intel facade. */
export function createBlastService(container: Container): BlastService {
  return new BlastService({
    reviews: container.reviewRepo,
    diffFiles: async (workspaceId, pull, repo) =>
      (await loadDiff(container, container.reviewRepo, workspaceId, pull, repo)).files.map((f) => f.path),
    githubFiles: async (pull, repo) => {
      const gh = await container.github();
      const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pull.number);
      return detail.files.map((f) => f.path);
    },
    repoIntel: container.repoIntel,
  });
}
