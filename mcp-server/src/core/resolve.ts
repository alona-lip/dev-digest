/**
 * Human ids → internal UUIDs. The API has no lookup by repo name, PR number or
 * agent name, so each is list-then-match. A miss returns `{ error }` with the
 * values the model could use instead; an API failure throws ApiError and the
 * tool maps it (format.apiFailure).
 */
import type { AgentListItem } from '@devdigest/shared';
import type { DevDigestClient } from '../http/client.js';

export type Miss = { error: string };

export type RepoRef = { repoId: string; fullName: string };
export type PullRef = RepoRef & { pullId: string };

/** How many PR numbers a "not found" hint lists. */
const PR_HINT_COUNT = 5;

/**
 * `repo` = 'owner/name' (exact, case-insensitive) or a bare name that only one
 * connected repo has.
 */
export async function resolveRepo(client: DevDigestClient, repo: string): Promise<RepoRef | Miss> {
  const repos = await client.listRepos();
  if (repos.length === 0) {
    return { error: 'No repositories are connected in DevDigest. Add one in the Studio (http://localhost:3000), then retry.' };
  }

  const needle = repo.trim().toLowerCase();
  const byFullName = repos.filter((r) => r.full_name.toLowerCase() === needle);
  const matches = byFullName.length > 0 ? byFullName : repos.filter((r) => r.name.toLowerCase() === needle);

  const [only] = matches;
  if (matches.length === 1 && only) return { repoId: only.id, fullName: only.full_name };

  if (matches.length > 1) {
    return {
      error: `Repo '${repo}' is ambiguous: ${matches.map((r) => r.full_name).join(', ')}. Pass it as owner/name.`,
    };
  }
  return {
    error: `Repo '${repo}' is not connected in DevDigest. Connected: ${repos.map((r) => r.full_name).join(', ')}. Pass one of these as owner/name.`,
  };
}

/** (repo, PR number) → pullId. The pulls list syncs from GitHub before answering. */
export async function resolvePull(client: DevDigestClient, repo: string, pr: number): Promise<PullRef | Miss> {
  const repoRef = await resolveRepo(client, repo);
  if ('error' in repoRef) return repoRef;

  const pulls = await client.listPulls(repoRef.repoId);
  const pull = pulls.find((p) => p.number === pr);
  // `PrMeta.id` is nullish: a PR GitHub returned but DevDigest has not persisted.
  if (pull?.id) return { ...repoRef, pullId: pull.id };

  const known = pulls
    .filter((p) => p.id)
    .slice(0, PR_HINT_COUNT)
    .map((p) => `#${p.number}`);
  const hint = known.length > 0 ? ` Known PRs: ${known.join(', ')}.` : ' DevDigest has no PRs for it yet.';
  return {
    error:
      `PR #${pr} not found in ${repoRef.fullName}.${hint} ` +
      `Check the number with \`gh pr list -R ${repoRef.fullName}\`; a brand-new PR appears after the repo is refreshed in DevDigest.`,
  };
}

/**
 * `agent` = an id from list_agents, or (fallback) an exact name, any case.
 * Disabled agents are allowed: the API runs an explicitly picked agent
 * regardless of `enabled` (ReviewService.resolveTargets).
 */
export function resolveAgent(agents: AgentListItem[], agent: string): AgentListItem | Miss {
  const needle = agent.trim().toLowerCase();
  const found = agents.find((a) => a.id === agent.trim()) ?? agents.find((a) => a.name.toLowerCase() === needle);
  if (found) return found;

  const available = agents.map((a) => `${a.id} (${a.name})`).join(', ') || 'none configured';
  return { error: `Agent '${agent}' not found. Call list_agents and pass an id from it. Available: ${available}.` };
}
