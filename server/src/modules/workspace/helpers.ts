import type { RepoRow } from '../../db/rows.js';

/** One repo in the `GET /workspace` overview. */
export function toWorkspaceRepoSummary(r: RepoRow) {
  return {
    id: r.id,
    full_name: r.fullName,
    clone_path: r.clonePath,
    last_polled_at: r.lastPolledAt?.toISOString() ?? null,
    cloned: Boolean(r.clonePath),
  };
}
