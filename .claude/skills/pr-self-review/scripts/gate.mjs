#!/usr/bin/env node
// Refuses `git push` / `gh pr create` unless pr-self-review passed for the
// commit being pushed. It never runs a review: it only reads the verdict
// written by report.mjs to .git/pr-self-review/<sha>.json.
//
//   gate.sh claude          Claude Code PreToolUse hook (JSON on stdin); exit 2 blocks the tool call
//   gate.sh pre-push ...    git pre-push hook (ref lines on stdin); exit 1 aborts the push
//   gate.sh check [sha]     manual: is this commit cleared for push / PR? exit 0 / 1
//   gate.sh check --worktree       is the current working tree cleared as "done"? exit 0 / 1
//
// Push / PR need a `--scope branch` verdict for the commit; "done" needs an
// `--scope uncommitted` verdict for the exact current working tree.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { headSha, stateDir, worktreeFingerprint } from './lib/git.mjs';

const ZERO = /^0+$/;
const TRIGGER = /(^|[\s;&|("'`])(gh\s+pr\s+create|git\s+push)(\s|$|["'`)])/;
const RERUN = 'Commit, then run /pr-self-review --scope branch (it must PASS for the commit you are pushing).';

export function problemFor(sha, dir = stateDir()) {
  const file = join(dir, `${sha}.json`);
  if (!existsSync(file)) return `No pr-self-review verdict for ${sha.slice(0, 8)}. ${RERUN}`;
  const v = JSON.parse(readFileSync(file, 'utf8'));
  if (v.verdict !== 'PASS') {
    const lines = (v.blocking ?? []).map((b) => `  - ${b}`).join('\n');
    return `pr-self-review BLOCKED ${sha.slice(0, 8)}: ${v.critical_count} CRITICAL finding(s).\n${lines}\nFix them and re-run /pr-self-review.`;
  }
  if (v.dirty) return `The PASS for ${sha.slice(0, 8)} was made with uncommitted changes, so it does not describe the commit. Commit everything, then re-run /pr-self-review --scope branch.`;
  return null;
}

/** "Is it done?": a PASS for exactly this working tree (any edit since makes it stale). */
export function problemForWorktree(fingerprint, dir = stateDir()) {
  const file = join(dir, `wt-${fingerprint}.json`);
  if (!existsSync(file)) return 'No pr-self-review verdict for the current working tree (none yet, or files changed since). Run /pr-self-review before calling the task done.';
  const v = JSON.parse(readFileSync(file, 'utf8'));
  if (v.verdict !== 'PASS') {
    const lines = (v.blocking ?? []).map((b) => `  - ${b}`).join('\n');
    return `pr-self-review BLOCKED the working tree: ${v.critical_count} blocking item(s).\n${lines}\nNot done yet: fix them and re-run /pr-self-review.`;
  }
  return null;
}

/**
 * What the shell would actually execute: heredoc bodies and quoted text (commit
 * messages, echo, grep patterns) are data, not commands. Quotes are kept when
 * the command runs a nested shell (`bash -c "git push"`, `eval`), where the
 * quoted text IS the command.
 */
export function executable(command) {
  let c = command.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\n|$)/g, ' ');
  if (!/\b(eval|(?:ba|z|da)?sh\s+(?:-\w+\s+)*-\w*c)\b/.test(c)) {
    c = c.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, ' ');
  }
  return c;
}

export function wantsGate(command) {
  const c = executable(command);
  if (!TRIGGER.test(c)) return false;
  if (/git\s+push\b/.test(c) && /(\s--delete\b|\s-d\s)/.test(c)) return false;
  return true;
}

function main() {
  const [mode, ...rest] = process.argv.slice(2);

  if (mode === 'claude') {
    let input = {};
    try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
    const command = input?.tool_input?.command ?? '';
    if (!wantsGate(command)) process.exit(0);
    if (input.cwd && existsSync(input.cwd)) process.chdir(input.cwd);
    const msg = problemFor(headSha());
    if (msg) { console.error(msg); process.exit(2); }
  } else if (mode === 'pre-push') {
    const lines = readFileSync(0, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      const [, localSha, remoteRef] = line.split(' ');
      if (!remoteRef?.startsWith('refs/heads/') || ZERO.test(localSha)) continue;
      const msg = problemFor(localSha);
      if (msg) { console.error(msg); process.exit(1); }
    }
  } else if (mode === 'check' && rest[0] === '--worktree') {
    const msg = problemForWorktree(worktreeFingerprint());
    if (msg) { console.log(msg); process.exit(1); }
    console.log('pr-self-review: working tree PASS');
  } else if (mode === 'check') {
    const msg = problemFor(rest[0] ?? headSha());
    if (msg) { console.log(msg); process.exit(1); }
    console.log('pr-self-review: PASS');
  } else {
    console.error('usage: gate.sh claude | pre-push | check [sha] | check --worktree');
    process.exit(2);
  }
}

if (process.argv[1] && process.argv[1].endsWith('gate.mjs')) main();
