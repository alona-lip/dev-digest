/**
 * repo-intel public facade — what OTHER modules may import from repo-intel.
 *
 * Deliberately narrow: the `RepoIntel` contract (types) and the constants
 * other modules need (job kinds the `repos` module enqueues). The service
 * itself is reached through `container.repoIntel`, and the routes plugin is
 * registered by `modules/index.ts` — neither is re-exported here.
 */
export * from './types.js';
export * from './constants.js';
