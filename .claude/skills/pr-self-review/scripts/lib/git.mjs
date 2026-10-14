import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

export const repoRoot = () => git(['rev-parse', '--show-toplevel']);
export const headSha = () => git(['rev-parse', 'HEAD']);

/** `.git/pr-self-review` (worktree-safe). Verdicts, cache and PR drafts live here, never in the tree. */
export const stateDir = () => resolve(repoRoot(), git(['rev-parse', '--git-path', 'pr-self-review'], { cwd: repoRoot() }));

export const isDirty = () => git(['status', '--porcelain']).length > 0;

/** Hash of the file as it is on disk now, committed or not. */
export const blobSha = (path) => git(['hash-object', '--', path], { cwd: repoRoot() });

/** Paths changed vs HEAD: staged, unstaged and untracked. */
export function uncommittedPaths() {
  const root = repoRoot();
  const tracked = git(['diff', '--name-only', 'HEAD'], { cwd: root }).split('\n');
  const untracked = git(['ls-files', '--others', '--exclude-standard'], { cwd: root }).split('\n');
  return [...new Set([...tracked, ...untracked].filter(Boolean))].sort();
}

/**
 * Identity of the working tree: HEAD + content of every uncommitted path.
 * Same tree → same fingerprint; touching any file changes it. The "done?"
 * verdict is keyed by this, so it goes stale the moment the code moves on.
 */
export function worktreeFingerprint() {
  const root = repoRoot();
  const parts = uncommittedPaths().map((p) => `${p}:${existsSync(join(root, p)) ? blobSha(p) : 'deleted'}`);
  return createHash('sha256').update([headSha(), ...parts].join('\n')).digest('hex').slice(0, 24);
}
