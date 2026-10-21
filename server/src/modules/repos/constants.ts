/**
 * F1 — repos module constants (extracted from routes.ts; no behaviour change).
 */

/** JobRunner kind for the asynchronous `git clone` job. */
export const CLONE_JOB_KIND = 'clone';

/** Clone depth — shallow clone (latest commit only) keeps imports fast. */
export const CLONE_DEPTH = 1;

/**
 * Parse `owner`/`repo` from a GitHub URL — supports
 * `https://github.com/owner/repo(.git)` (scheme and `www.` optional) and
 * `git@github.com:owner/repo.git`. Anchored at both ends and restricted to
 * GitHub's character set, so neither a foreign host that merely contains
 * `github.com/` nor a `..` path segment gets through. Repo names may contain
 * dots (`vercel/next.js`); the lazy group lets an optional `.git` suffix go.
 */
export const GITHUB_URL_REGEX =
  /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/|git@github\.com:)([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

/** Names that are path segments, never a repository (`..` would escape the clone dir). */
export const RESERVED_REPO_NAMES: ReadonlySet<string> = new Set(['.', '..']);
