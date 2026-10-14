// node --test .claude/skills/pr-self-review/scripts/
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globToRegExp } from './lib/glob.mjs';
import { parseNameStatus, renderTable, route } from './route.mjs';
import { checkRouting } from './check-routing.mjs';
import { applyWaivers } from './waivers.mjs';
import { CHECK_NAMES, lockfileWarnings, migrationChecks, triggeredChecks } from './checks.mjs';
import { decide, renderReport, verdictFile } from './report.mjs';
import { problemFor, problemForWorktree, wantsGate } from './gate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const routing = JSON.parse(readFileSync(join(here, '..', 'routing.json'), 'utf8'));
const entries = (...paths) => paths.map((path) => ({ status: 'M', path }));
const skillsOf = (r, bucket) => Object.keys(r.buckets[bucket]?.skills ?? {}).sort();
const filesOf = (r, bucket, skill) => r.buckets[bucket]?.skills[skill] ?? [];
const skillNames = () => {
  const dir = join(here, '..', '..');
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'SKILL.md')))
    .map((d) => d.name);
};

// ── glob ──────────────────────────────────────────────────────────────────

test('glob: ** spans directories, * does not, {a,b} alternates', () => {
  assert.ok(globToRegExp('client/src/**/*.tsx').test('client/src/app/x/Page.tsx'));
  assert.ok(globToRegExp('client/src/**/*.tsx').test('client/src/Page.tsx'));
  assert.ok(!globToRegExp('server/src/*.ts').test('server/src/modules/a.ts'));
  assert.ok(globToRegExp('**/*.{ts,tsx}').test('a/b/c.tsx'));
  assert.ok(!globToRegExp('**/*.{ts,tsx}').test('a/b/c.js'));
});

// ── buckets ───────────────────────────────────────────────────────────────

test('Frontend: a component gets the full client core (UI-arch + react + RTL), plus next under app/', () => {
  const r = route(entries('client/src/components/foo-bar/FooBar.tsx', 'client/src/app/x/_components/A/A.tsx'), routing);
  assert.deepEqual(filesOf(r, 'Frontend', 'react-testing-library').length, 2);
  assert.deepEqual(skillsOf(r, 'Frontend'), ['frontend-ui-architecture', 'next-best-practices', 'react-best-practices', 'react-testing-library']);
  assert.deepEqual(filesOf(r, 'Frontend', 'next-best-practices'), ['client/src/app/x/_components/A/A.tsx']);
});

test('Frontend: a test file gets RTL only', () => {
  const r = route(entries('client/src/app/x/Foo.test.tsx'), routing);
  assert.deepEqual(skillsOf(r, 'Frontend'), ['react-testing-library']);
});

test('Backend: routes by surface — service.ts alone gets Onion + fastify + drizzle, no UI skills', () => {
  const r = route(entries('server/src/modules/pulls/service.ts'), routing);
  assert.deepEqual(skillsOf(r, 'Backend'), ['drizzle-orm-patterns', 'fastify-best-practices', 'onion-architecture']);
  assert.equal(r.buckets.Frontend, undefined);
});

test('Backend: routes.ts adds security, schema adds postgres design', () => {
  const r = route(entries('server/src/modules/pulls/routes.ts', 'server/src/db/schema.ts'), routing);
  assert.deepEqual(filesOf(r, 'Backend', 'security'), ['server/src/modules/pulls/routes.ts']);
  assert.deepEqual(filesOf(r, 'Backend', 'postgresql-table-design'), ['server/src/db/schema.ts']);
});

test('Database, Engine and Shared contracts buckets', () => {
  const r = route(
    entries('server/src/db/migrations/0009_x.sql', 'reviewer-core/src/prompt.ts', 'client/src/vendor/shared/index.ts'),
    routing,
  );
  assert.deepEqual(skillsOf(r, 'Database'), ['postgresql-table-design']);
  assert.deepEqual(skillsOf(r, 'Engine'), ['onion-architecture']);
  assert.deepEqual(skillsOf(r, 'Shared contracts'), ['zod']);
  assert.equal(r.buckets.Frontend, undefined, 'vendored contracts are not Frontend code');
});

test('every file lands in at most one bucket', () => {
  const files = [
    'client/src/app/a/A.tsx', 'client/src/app/a/A.test.tsx', 'client/src/vendor/shared/x.ts',
    'server/src/modules/a/routes.ts', 'server/src/vendor/shared/x.ts', 'server/src/db/migrations/0001_a.sql',
    'reviewer-core/src/llm/x.ts',
  ];
  const r = route(entries(...files), routing);
  const placed = Object.values(r.buckets).flatMap((b) => b.files);
  assert.equal(placed.length, files.length);
  assert.equal(new Set(placed).size, files.length);
});

test('extras by content: zod only when imported', () => {
  const src = { 'server/src/a.ts': "import { z } from 'zod'", 'server/src/b.ts': 'export const b = 1' };
  const r = route(entries('server/src/a.ts', 'server/src/b.ts'), routing, (p) => src[p]);
  assert.deepEqual(filesOf(r, 'Backend', 'zod'), ['server/src/a.ts']);
});

test('ignored, deleted and not-covered files are reported, not silently dropped', () => {
  const r = route(
    [
      { status: 'D', path: 'client/src/old.tsx' },
      { status: 'M', path: 'README.md' },
      { status: 'M', path: 'client/pnpm-lock.yaml' },
      { status: 'M', path: 'e2e/specs/01-a.flow.json' },
      { status: 'M', path: 'server/test/a.test.ts' },
    ],
    routing,
  );
  assert.deepEqual(r.deleted, ['client/src/old.tsx']);
  assert.deepEqual(r.ignored.sort(), ['README.md', 'client/pnpm-lock.yaml']);
  assert.deepEqual(r.uncovered, ['e2e/specs/01-a.flow.json', 'server/test/a.test.ts']);
});

test('parseNameStatus handles renames', () => {
  const [e] = parseNameStatus('R100\ta.ts\tb.ts\n');
  assert.deepEqual(e, { status: 'R', path: 'b.ts', oldPath: 'a.ts' });
});

// ── routing integrity ─────────────────────────────────────────────────────

test('routing.json is consistent with .claude/skills and checks.mjs', () => {
  assert.deepEqual(checkRouting(skillNames(), routing), []);
});

test('check-routing: unmapped skill, dangling name, broken required core, unknown check', () => {
  assert.ok(checkRouting([...skillNames(), 'brand-new-skill'], routing).some((p) => p.includes('"brand-new-skill" is in no bucket')));
  assert.ok(checkRouting(['zod'], routing).some((p) => p.includes('does not exist')));

  const noDrizzle = structuredClone(routing);
  noDrizzle.buckets.find((b) => b.name === 'Backend').core = ['onion-architecture', 'fastify-best-practices'];
  noDrizzle.buckets.find((b) => b.name === 'Database').core.push('drizzle-orm-patterns'); // still routed somewhere
  assert.ok(checkRouting(skillNames(), noDrizzle).some((p) => p.includes('bucket "Backend" core')));

  const badCheck = structuredClone(routing);
  badCheck.buckets[0].checks.push('nope');
  assert.ok(checkRouting(skillNames(), badCheck).some((p) => p.includes('"nope"')));
});

test('routing.md is generated from routing.json and up to date', () => {
  const md = readFileSync(join(here, '..', 'routing.md'), 'utf8');
  assert.equal(md, renderTable(routing), 'run: node scripts/route.mjs --print-table > routing.md');
  for (const b of routing.buckets) assert.ok(md.includes(`**${b.name}**`));
});

// ── deterministic checks ──────────────────────────────────────────────────

test('checks are triggered by routing.json, including server/test and renamed-from paths', () => {
  assert.deepEqual(triggeredChecks(entries('server/test/a.test.ts'), routing), ['server-typecheck-tests']);
  assert.deepEqual(triggeredChecks(entries('README.md'), routing), []);
  const renamedOut = [{ status: 'R', path: 'tmp/x.sql', oldPath: 'server/src/db/migrations/0001_a.sql' }];
  assert.ok(triggeredChecks(renamedOut, routing).includes('migrations'));
  assert.ok(CHECK_NAMES.includes('migrations'));
});

test('migrations: editing an applied one is CRITICAL, adding one is not', () => {
  const j = { entries: [{ idx: 0 }, { idx: 1 }] };
  const edit = migrationChecks([{ status: 'M', path: 'server/src/db/migrations/0001_x.sql' }], { baseJournal: j, currentJournal: j });
  assert.equal(edit[0].severity, 'CRITICAL');
  const add = migrationChecks(
    [
      { status: 'A', path: 'server/src/db/migrations/0002_y.sql' },
      { status: 'M', path: 'server/src/db/migrations/meta/_journal.json' },
    ],
    { baseJournal: j, currentJournal: { entries: [...j.entries, { idx: 2 }] } },
  );
  assert.deepEqual(add, []);
  const rewritten = migrationChecks([{ status: 'M', path: 'server/src/db/migrations/meta/_journal.json' }], {
    baseJournal: j,
    currentJournal: { entries: [{ idx: 0 }, { idx: 9 }] },
  });
  assert.equal(rewritten.length, 1);
});

test('lockfile without package.json is a WARNING', () => {
  const [w] = lockfileWarnings(entries('server/pnpm-lock.yaml'));
  assert.equal(w.severity, 'WARNING');
  assert.deepEqual(lockfileWarnings(entries('server/pnpm-lock.yaml', 'server/package.json')), []);
});

// ── waivers & verdict ─────────────────────────────────────────────────────

const crit = { bucket: 'Backend', skill: 'drizzle-orm-patterns', file: 'server/src/a.ts', line_start: 1, line_end: 2, severity: 'CRITICAL', title: 't', rule: 'r', mechanism: 'm' };
const today = new Date('2026-10-14T00:00:00Z');

test('waivers: valid waiver unblocks a CRITICAL', () => {
  const w = [{ file: 'server/src/**', rule: 'r', reason: 'false positive', expires: '2026-11-01' }];
  const { findings } = applyWaivers([crit], w, today);
  assert.equal(findings[0].waived, true);
  assert.equal(decide(findings, []).verdict, 'PASS');
});

test('waivers: no reason, expired, or too far ahead are ignored with a warning', () => {
  for (const bad of [
    { file: 'server/src/a.ts', rule: 'r', reason: '', expires: '2026-11-01' },
    { file: 'server/src/a.ts', rule: 'r', reason: 'x', expires: '2026-10-01' },
    { file: 'server/src/a.ts', rule: 'r', reason: 'x', expires: '2027-06-01' },
  ]) {
    const { findings, warnings } = applyWaivers([crit], [bad], today);
    assert.equal(findings[0].waived, undefined);
    assert.equal(warnings.length, 1);
    assert.equal(decide(findings, []).verdict, 'BLOCK');
  }
});

test('waivers never apply to deterministic findings', () => {
  const w = [{ file: '**', rule: 'r', reason: 'x', expires: '2026-11-01' }];
  assert.equal(applyWaivers([{ ...crit, deterministic: true }], w, today).findings[0].waived, undefined);
});

test('verdict: unwaived CRITICAL, failed CRITICAL check, or a reviewer that never answered blocks', () => {
  assert.equal(decide([crit], []).verdict, 'BLOCK');
  assert.equal(decide([{ ...crit, severity: 'WARNING' }], []).verdict, 'PASS');
  assert.equal(decide([], [{ name: 'x', status: 'fail', severity: 'CRITICAL', summary: 's' }]).verdict, 'BLOCK');
  assert.equal(decide([], [{ name: 'lockfile', status: 'fail', severity: 'WARNING', summary: 's' }]).verdict, 'PASS');
  assert.equal(decide([], [{ name: 'x', status: 'skipped', severity: 'WARNING', summary: 's' }]).verdict, 'PASS');
  assert.equal(decide([], [], ['Backend/drizzle-orm-patterns']).verdict, 'BLOCK');
});

test('verdict file: branch scope by commit, uncommitted scope by working-tree fingerprint', () => {
  assert.equal(verdictFile('branch', { head: 'abc', fingerprint: 'f1' }), 'abc.json');
  assert.equal(verdictFile('uncommitted', { head: 'abc', fingerprint: 'f1' }), 'wt-f1.json');
});

test('report is grouped by bucket and shows not-covered files and failed reviewers', () => {
  const r = route(entries('client/src/a/A.tsx', 'server/src/modules/a/service.ts', 'e2e/x.ts'), routing);
  const text = renderReport({
    scope: 'uncommitted', result: decide([crit], [], []), findings: [crit], checks: [], route: r,
    stats: null, warnings: [], dirty: true, notReviewed: ['Backend/fastify-best-practices'],
  });
  const fe = text.indexOf('### Frontend');
  const be = text.indexOf('### Backend');
  assert.ok(fe > -1 && be > fe);
  assert.match(text, /fastify-best-practices \(1\) ✗ not reviewed/);
  assert.match(text, /### Not covered — 1 file/);
  assert.doesNotMatch(text, /### Engine/);
  assert.doesNotMatch(text, /push gate will not accept/, 'a dirty tree is the normal state for an uncommitted review');
});

// ── gate ──────────────────────────────────────────────────────────────────

test('gate: only push / pr create are gated, deleting a branch is not', () => {
  assert.ok(wantsGate('git push origin HEAD'));
  assert.ok(wantsGate('cd x && gh pr create --fill'));
  assert.ok(!wantsGate('git push origin --delete old'));
  assert.ok(!wantsGate('git status && echo gh pr list'));
});

test('gate: mentions inside quotes or heredocs are data, nested shells are not', () => {
  assert.ok(!wantsGate('git commit -m "fix: do not git push before review"'));
  assert.ok(!wantsGate("echo 'gh pr create' > notes.txt"));
  assert.ok(!wantsGate("cat > f.md <<'EOF'\nrun gh pr create when ready\nEOF"));
  assert.ok(wantsGate("cat <<'EOF' > f\nx\nEOF\ngit push origin HEAD"));
  assert.ok(wantsGate('bash -c "git push origin HEAD"'));
  assert.ok(wantsGate("eval 'gh pr create'"));
  assert.ok(wantsGate('git add . && git commit -m "x" && git push'));
});

test('gate (commit): missing, BLOCK, dirty and PASS verdicts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  const sha = 'a'.repeat(40);
  assert.match(problemFor(sha, dir), /No pr-self-review verdict.*--scope branch/);
  writeFileSync(join(dir, `${sha}.json`), JSON.stringify({ verdict: 'BLOCK', critical_count: 1, blocking: ['[security] a.ts:1 — t'] }));
  assert.match(problemFor(sha, dir), /BLOCKED[\s\S]*a\.ts:1/);
  writeFileSync(join(dir, `${sha}.json`), JSON.stringify({ verdict: 'PASS', dirty: true }));
  assert.match(problemFor(sha, dir), /uncommitted/);
  writeFileSync(join(dir, `${sha}.json`), JSON.stringify({ verdict: 'PASS', dirty: false }));
  assert.equal(problemFor(sha, dir), null);
});

test('gate (worktree): a PASS counts only for the exact same tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-wt-'));
  assert.match(problemForWorktree('f1', dir), /No pr-self-review verdict for the current working tree/);
  writeFileSync(join(dir, 'wt-f1.json'), JSON.stringify({ verdict: 'BLOCK', critical_count: 1, blocking: ['x'] }));
  assert.match(problemForWorktree('f1', dir), /Not done yet/);
  writeFileSync(join(dir, 'wt-f1.json'), JSON.stringify({ verdict: 'PASS', dirty: true }));
  assert.equal(problemForWorktree('f1', dir), null);
  assert.notEqual(problemForWorktree('f2', dir), null, 'a different tree has no verdict');
});
