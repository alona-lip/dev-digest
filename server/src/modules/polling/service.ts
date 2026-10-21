import type { GitHubClient } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';

/**
 * Manual PR-list refresh: sync new/updated PRs from GitHub and bump the repo's
 * `last_polled_at`. Never triggers a review — review is manual (Run Review).
 *
 * Uses the pulls repository through the container (`container.pullsRepo`), so
 * the GitHub → row projection is the same one the PR list uses.
 */
export class PollingService {
  constructor(
    private readonly pulls: Container['pullsRepo'],
    private readonly github: () => Promise<GitHubClient>,
  ) {}

  async poll(workspaceId: string, repoId: string): Promise<{ synced: number; reviewTriggered: false }> {
    const repo = await this.pulls.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    const gh = await this.github();
    const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
    const synced = await this.pulls.upsertFromGitHub(workspaceId, repo.id, pulls);
    await this.pulls.markPolled(repo.id);
    // NOTE: no review is triggered here — manual trigger only.
    return { synced, reviewTriggered: false };
  }
}
