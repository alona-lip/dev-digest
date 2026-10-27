#!/usr/bin/env node
// Deterministic checks (no LLM) over the changed files. Any failure marked
// CRITICAL blocks the verdict and cannot be waived.
//
//   collect-diff.sh files | node checks.mjs --base <sha> [--no-cache]
//   → JSON array: {name, status: pass|fail|skipped, severity, summary, tail, cached, deterministic}
//
// WHEN a check runs is routing.json `checks.<name>.on` (globs over changed
// paths); HOW it runs is the COMMANDS registry below. check-routing.mjs keeps
// the two in sync.
//
// Passing runs are cached by (check, base, blobs of the files in its scope);
// failures are never cached, so a flaky test is simply re-run.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseNameStatus, ROUTING_PATH } from './route.mjs';
import { blobSha, git, repoRoot } from './lib/git.mjs';
import { matchesAny } from './lib/glob.mjs';
import { rawPath } from './cache.mjs';

const MIGRATIONS = 'server/src/db/migrations/';
const JOURNAL = `${MIGRATIONS}meta/_journal.json`;

const LOCKFILES = [
  ['client/pnpm-lock.yaml', 'client/package.json'],
  ['server/pnpm-lock.yaml', 'server/package.json'],
  ['reviewer-core/package-lock.json', 'reviewer-core/package.json'],
  ['e2e/package-lock.json', 'e2e/package.json'],
  ['mcp-server/pnpm-lock.yaml', 'mcp-server/package.json'],
];

/** Command checks: name → [command, cwd relative to the repo root]. */
const COMMANDS = {
  'link-agents': ['./scripts/link-agents.sh --check', '.'],
  'check-shared': ['./scripts/check-shared.sh', '.'],
  'arch-check': ['pnpm arch:check', 'server'],
  'server-typecheck-tests': ["pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'", 'server'],
  'client-typecheck-tests': ['pnpm typecheck && pnpm test', 'client'],
  'reviewer-core-typecheck-tests': ['npm run typecheck && npm test', 'reviewer-core'],
  'mcp-server-typecheck-tests': ['pnpm typecheck && pnpm test', 'mcp-server'],
};

/** Checks implemented in code rather than as a command. */
const BUILTIN = ['migrations', 'lockfile'];

export const CHECK_NAMES = [...BUILTIN, ...Object.keys(COMMANDS)];

/** Which checks the changed paths trigger (renamed-from paths count too). */
export function triggeredChecks(entries, routing) {
  const paths = entries.flatMap((e) => [e.path, e.oldPath].filter(Boolean));
  return Object.entries(routing.checks)
    .filter(([, c]) => paths.some((p) => matchesAny(p, c.on)))
    .map(([name]) => name);
}

const fail = (name, summary, extra = {}) => ({ name, status: 'fail', severity: 'CRITICAL', summary, deterministic: true, ...extra });

/** Applied migrations are immutable; only additions (and an append-only journal) are legitimate. */
export function migrationChecks(entries, { baseJournal, currentJournal }) {
  const out = [];
  for (const { status, path, oldPath } of entries) {
    for (const p of [path, oldPath].filter(Boolean)) {
      if (!p.startsWith(MIGRATIONS)) continue;
      if (p === JOURNAL) {
        if (status === 'D' || status === 'R') out.push(fail('migrations', `${JOURNAL} was ${status === 'D' ? 'deleted' : 'renamed'}`));
        else if (status === 'M') {
          const before = baseJournal?.entries ?? [];
          const after = currentJournal?.entries ?? [];
          const intact = before.every((e, i) => JSON.stringify(e) === JSON.stringify(after[i]));
          if (!intact) out.push(fail('migrations', `${JOURNAL}: an existing entry was edited, reordered or removed`));
        }
      } else if (status !== 'A') {
        out.push(fail('migrations', `applied migration file ${p} was ${{ M: 'modified', D: 'deleted', R: 'renamed' }[status] ?? status}`));
      }
    }
  }
  return out;
}

export function lockfileWarnings(entries) {
  const changed = new Set(entries.map((e) => e.path));
  return LOCKFILES.filter(([lock, pkg]) => changed.has(lock) && !changed.has(pkg)).map(([lock, pkg]) => ({
    name: 'lockfile',
    status: 'fail',
    severity: 'WARNING',
    summary: `${lock} changed but ${pkg} did not (lock files change only as a by-product of a package-manager command)`,
    deterministic: true,
  }));
}

function run(cmd, cwd) {
  const r = spawnSync('bash', ['-lc', cmd], { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-40).join('\n');
  return { ok: r.status === 0, tail };
}

function scopeKey(name, base, entries, inScope) {
  const parts = entries
    .filter((e) => e.status !== 'D' && inScope(e.path) && existsSync(join(repoRoot(), e.path)))
    .map((e) => `${e.path}:${blobSha(e.path)}`)
    .sort();
  return createHash('sha256').update([name, base, ...parts].join('\n')).digest('hex');
}

function cachedRun({ name, cmd, cwd, entries, base, inScope, noCache }) {
  const key = scopeKey(name, base, entries, inScope);
  const p = rawPath('checks', key);
  if (!noCache && existsSync(p)) return { name, status: 'pass', severity: 'CRITICAL', summary: `${cmd} (cached)`, cached: true, deterministic: true };
  const { ok, tail } = run(cmd, cwd);
  if (!ok) return fail(name, `${cmd} failed`, { tail });
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, '1');
  return { name, status: 'pass', severity: 'CRITICAL', summary: cmd, cached: false, deterministic: true };
}

export function runChecks(entries, base, routing, { noCache = false } = {}) {
  const root = repoRoot();
  const results = [];
  const scopeOf = (name) => (p) => matchesAny(p, routing.checks[name].on);

  for (const name of triggeredChecks(entries, routing)) {
    if (name === 'migrations') {
      let baseJournal = null;
      try { baseJournal = JSON.parse(git(['show', `${base}:${JOURNAL}`])); } catch { /* no journal at base */ }
      const cur = join(root, JOURNAL);
      const currentJournal = existsSync(cur) ? JSON.parse(readFileSync(cur, 'utf8')) : null;
      const bad = migrationChecks(entries, { baseJournal, currentJournal });
      results.push(...(bad.length ? bad : [{ name, status: 'pass', severity: 'CRITICAL', summary: 'only additions to migrations', deterministic: true }]));
      continue;
    }
    if (name === 'lockfile') {
      const warn = lockfileWarnings(entries);
      results.push(...(warn.length ? warn : [{ name, status: 'pass', severity: 'WARNING', summary: 'lock files changed together with package.json', deterministic: true }]));
      continue;
    }
    const [cmd, dir] = COMMANDS[name];
    const cwd = join(root, dir);
    if (dir !== '.' && !existsSync(join(cwd, 'node_modules'))) {
      results.push({ name, status: 'skipped', severity: 'WARNING', summary: `${dir}/node_modules is missing — not verified (install dependencies first)`, deterministic: true });
      continue;
    }
    results.push(cachedRun({ name, cmd, cwd, entries, base, noCache, inScope: scopeOf(name) }));
  }
  return results;
}

if (process.argv[1] && process.argv[1].endsWith('checks.mjs')) {
  const args = process.argv.slice(2);
  const base = args[args.indexOf('--base') + 1];
  const entries = parseNameStatus(readFileSync(0, 'utf8'));
  const routing = JSON.parse(readFileSync(ROUTING_PATH, 'utf8'));
  console.log(JSON.stringify(runChecks(entries, base, routing, { noCache: args.includes('--no-cache') }), null, 2));
}
