/**
 * reviews public facade — what OTHER modules may import from reviews.
 *
 * `intent` derives a PR's scope from the same diff a review run reviews, so it
 * reuses `loadDiff` (git diff, else the persisted pr_files patches). The
 * repository instance itself is reached through `container.reviewRepo`.
 */
export { loadDiff } from './diff-loader.js';
export type { ReviewRepository } from './repository.js';
