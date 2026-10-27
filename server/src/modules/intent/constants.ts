/** Classifier sampling temperature — near-deterministic, it only summarises. */
export const LLM_TEMPERATURE = 0.1;

/** Same cap reviewer-core applies to the PR body in the review prompt. */
export const MAX_BODY_CHARS = 4000;

/** Per-kind caps on references parsed out of a PR body (first N win). */
export const MAX_REPO_FILE_REFS = 5;
export const MAX_GITHUB_REFS = 5;
export const MAX_URL_REFS = 3;

/**
 * Total characters of fetched reference content folded into the classifier
 * input — so one huge plan file can't erase the header-only token savings.
 */
export const REFERENCE_BUDGET_CHARS = 12_000;
export const TRUNCATION_MARKER = '\n…[truncated]';

/** Outbound limits for an external https:// reference (UrlFetcher options). */
export const URL_FETCH = { timeoutMs: 10_000, maxBytes: 100_000 } as const;

/** Bare (non-link) paths are references only under these dirs — at any depth, e.g. `server/specs/x.md`. */
export const DOC_DIRS = ['docs', 'specs', 'plans'] as const;
export const DOC_EXTENSIONS = ['md', 'mdx', 'txt'] as const;

/** Keep the changed-files block bounded on huge PRs. */
export const MAX_FILES_LISTED = 200;
export const MAX_HUNKS_PER_FILE = 20;
