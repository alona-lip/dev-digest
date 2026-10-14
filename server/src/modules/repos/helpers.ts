import { type Repo } from '@devdigest/shared';
import type { RepoRow } from '../../db/rows.js';
import { AppError } from '../../platform/errors.js';
import { GITHUB_URL_REGEX, RESERVED_REPO_NAMES } from './constants.js';

/**
 * F1 — repos pure helpers (extracted from routes.ts; no behaviour change).
 * Pure functions only — no I/O, no DB, no container.
 */

/** Parse `owner`/`name` from a GitHub URL (https or ssh form). */
export function parseRepoUrl(url: string): { owner: string; name: string } {
  // https://github.com/owner/repo(.git)  |  git@github.com:owner/repo.git
  const match = url.trim().match(GITHUB_URL_REGEX);
  if (!match?.[1] || !match[2] || RESERVED_REPO_NAMES.has(match[2])) {
    throw new AppError('invalid_repo_url', `Could not parse owner/repo from '${url}'`, 400);
  }
  return { owner: match[1], name: match[2] };
}

/**
 * The only URL ever handed to `git clone`: rebuilt from the parsed parts, so
 * the user's raw string (another host, `file://`, embedded credentials) never
 * reaches git. Auth is added by the git adapter as a header, not in the URL.
 */
export function canonicalCloneUrl(owner: string, name: string): string {
  return `https://github.com/${owner}/${name}.git`;
}

/** Map a persisted repo row to the API `Repo` DTO. */
export function toRepoDto(row: RepoRow): Repo {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    owner: row.owner,
    name: row.name,
    full_name: row.fullName,
    default_branch: row.defaultBranch,
    clone_path: row.clonePath,
    last_polled_at: row.lastPolledAt?.toISOString() ?? null,
    created_by: row.createdBy,
  };
}
