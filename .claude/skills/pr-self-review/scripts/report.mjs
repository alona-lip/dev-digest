#!/usr/bin/env node
// Turns findings + check results into the verdict, writes it, and prints the
// report grouped by bucket.
//
//   report.mjs --scope uncommitted|branch --findings F.json --checks C.json
//              --route R.json --entries E.txt [--warnings W.json]
//              [--not-reviewed N.json] [--stats '{"reviewed":3,"cached":2}'] [--base SHA]
//
// findings:     post-waiver array ({bucket,skill,file,line_start,line_end,severity,title,rule,mechanism,waived?})
// not-reviewed: ["Backend/drizzle-orm-patterns", ...] — reviewers that never returned valid JSON
//
// writes, by scope:
//   uncommitted → .git/pr-self-review/wt-<worktree fingerprint>.json   ("is it done?")
//   branch      → .git/pr-self-review/<HEAD>.json (+ <HEAD>.pr.md on PASS)   (push / PR gate)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNameStatus } from './route.mjs';
import { headSha, isDirty, stateDir, worktreeFingerprint } from './lib/git.mjs';

const ORDER = ['CRITICAL', 'WARNING', 'SUGGESTION'];
const NOT_COVERED = 'Not covered';
const loc = (f) => `${f.file}:${f.line_start}${f.line_end && f.line_end !== f.line_start ? `-${f.line_end}` : ''}`;

export function decide(findings, checks, notReviewed = []) {
  const blockingFindings = findings.filter((f) => f.severity === 'CRITICAL' && !f.waived);
  const blockingChecks = checks.filter((c) => c.status === 'fail' && c.severity === 'CRITICAL');
  const blocking = [
    ...blockingChecks.map((c) => `[check:${c.name}] ${c.summary}`),
    ...notReviewed.map((r) => `[not reviewed] ${r} — the reviewer returned no valid result; re-run`),
    ...blockingFindings.map((f) => `[${f.bucket ? `${f.bucket}/` : ''}${f.skill}] ${loc(f)} — ${f.title}`),
  ];
  return { verdict: blocking.length ? 'BLOCK' : 'PASS', blocking, critical_count: blocking.length };
}

export function verdictFile(scope, { head, fingerprint }) {
  return scope === 'branch' ? `${head}.json` : `wt-${fingerprint}.json`;
}

const countBy = (fs) => ORDER.map((s) => `${fs.filter((f) => f.severity === s && !f.waived).length} ${s}`).join(' · ');

export function renderReport({ scope, result, findings, checks, route, stats, warnings, dirty, notReviewed = [] }) {
  const L = [];
  const what = scope === 'branch' ? 'branch vs main (pre-PR)' : 'uncommitted changes ("done?")';
  L.push(`## PR self-review: ${result.verdict === 'PASS' ? '✅ PASS' : '⛔ BLOCK'} — ${what}`);
  if (scope === 'branch' && dirty) {
    L.push('', '> ⚠ Branch review with uncommitted changes — the push gate will not accept this verdict. Commit, then re-run with `--scope branch`.');
  }
  if (result.blocking.length) L.push('', '**Blocking:**', ...result.blocking.map((b) => `- ${b}`));

  const checkLine = (c) => {
    const icon = c.status === 'pass' ? '✅' : c.status === 'skipped' ? '⏭' : c.severity === 'CRITICAL' ? '⛔' : '⚠';
    return `${icon} ${c.name}`;
  };

  for (const [name, b] of Object.entries(route.buckets)) {
    const bf = findings.filter((f) => f.bucket === name);
    L.push('', `### ${name} — ${b.files.length} file${b.files.length === 1 ? '' : 's'}`);
    const skills = Object.entries(b.skills).map(([s, files]) => {
      const failed = notReviewed.includes(`${name}/${s}`);
      const cap = route.caps?.[s] ? `, max ${route.caps[s]}` : '';
      return `${s} (${files.length}${cap}) ${failed ? '✗ not reviewed' : '✓'}`;
    });
    L.push(`skills: ${skills.join(' · ')}`);
    L.push(`findings: ${countBy(bf)}`);
  }
  if (route.uncovered.length) {
    const shown = route.uncovered.slice(0, 10).join(', ');
    const more = route.uncovered.length > 10 ? ` … +${route.uncovered.length - 10} more` : '';
    L.push('', `### ${NOT_COVERED} — ${route.uncovered.length} file${route.uncovered.length === 1 ? '' : 's'}`, `${shown}${more}`);
  }
  if (!Object.keys(route.buckets).length && !route.uncovered.length) L.push('', '_Nothing to review._');
  if (stats) L.push('', `Reviewed ${stats.reviewed ?? 0} skill×file unit(s), ${stats.cached ?? 0} from cache.`);

  L.push('', '### Checks', checks.length ? checks.map(checkLine).join(' · ') : 'none applicable');
  for (const c of checks.filter((x) => x.status !== 'pass')) {
    L.push(`- \`${c.name}\` — ${c.summary}`);
    if (c.tail) L.push('  ```', ...c.tail.split('\n').map((t) => `  ${t}`), '  ```');
  }

  for (const sev of ORDER) {
    const group = findings.filter((f) => f.severity === sev && !f.waived);
    if (!group.length) continue;
    L.push('', `### ${sev} (${group.length})`);
    for (const f of group) L.push(`- **${loc(f)}** [${f.bucket ?? '?'} / ${f.skill}] ${f.title} — ${f.mechanism}`);
  }
  const waived = findings.filter((f) => f.waived);
  if (waived.length) {
    L.push('', `### Waived (${waived.length})`);
    for (const f of waived) L.push(`- **${loc(f)}** [${f.bucket ?? '?'} / ${f.skill}] ${f.title} — waived: ${f.waiver.reason} (until ${f.waiver.expires})`);
  }
  if (warnings?.length) L.push('', '### Waiver problems', ...warnings.map((w) => `- ${w}`));
  return L.join('\n');
}

function byPackage(entries) {
  const m = {};
  for (const { status, path } of entries) {
    const pkg = ['client', 'server', 'reviewer-core', 'e2e'].find((p) => path.startsWith(`${p}/`)) ?? 'repo root';
    const c = (m[pkg] ??= { A: 0, M: 0, D: 0, R: 0 });
    c[status in c ? status : 'M']++;
  }
  return m;
}

export function renderPrDraft({ findings, checks, route, entries, warnings }) {
  const L = ['## Summary', ''];
  for (const [pkg, c] of Object.entries(byPackage(entries))) {
    L.push(`- \`${pkg}\`: ${c.A} added, ${c.M} modified, ${c.R} renamed, ${c.D} deleted`);
  }
  L.push('', '<!-- Add: what changed and why, in a sentence or two. -->', '', '## Checks', '');
  for (const c of checks) L.push(`- [${c.status === 'pass' ? 'x' : ' '}] ${c.name}: ${c.summary}`);
  if (!checks.length) L.push('- none applicable to this diff');
  L.push('', '## Reviewed by', '');
  for (const [name, b] of Object.entries(route.buckets)) {
    L.push(`- **${name}** (${b.files.length} files): ${Object.keys(b.skills).join(', ')}`);
  }
  if (route.uncovered.length) L.push(`- **${NOT_COVERED}** (${route.uncovered.length} files)`);
  if (!Object.keys(route.buckets).length) L.push('- no reviewable files');
  L.push('', '## Known warnings', '');
  const warn = findings.filter((f) => f.severity !== 'CRITICAL');
  if (warn.length) for (const f of warn) L.push(`- ${f.severity} ${loc(f)} [${f.bucket ?? '?'} / ${f.skill}] ${f.title}`);
  else L.push('- none');
  for (const w of warnings ?? []) L.push(`- ${w}`);
  L.push('', '## Waived', '');
  const waived = findings.filter((f) => f.waived);
  if (waived.length) for (const f of waived) L.push(`- ${loc(f)} [${f.skill}] ${f.title} — ${f.waiver.reason} (until ${f.waiver.expires})`);
  else L.push('- none');
  return L.join('\n') + '\n';
}

if (process.argv[1] && process.argv[1].endsWith('report.mjs')) {
  const args = process.argv.slice(2);
  const opt = (n, d) => (args.indexOf(n) === -1 ? d : args[args.indexOf(n) + 1]);
  const json = (n, d) => (opt(n) ? JSON.parse(readFileSync(opt(n), 'utf8')) : d);

  const scope = opt('--scope', 'uncommitted');
  if (!['uncommitted', 'branch'].includes(scope)) {
    console.error(`unknown --scope ${scope} (uncommitted|branch)`);
    process.exit(2);
  }
  const findings = json('--findings', []);
  const checks = json('--checks', []);
  const route = json('--route', { buckets: {}, uncovered: [], caps: {} });
  const warnings = json('--warnings', []);
  const notReviewed = json('--not-reviewed', []);
  const entries = opt('--entries') ? parseNameStatus(readFileSync(opt('--entries'), 'utf8')) : [];
  const stats = opt('--stats') ? JSON.parse(opt('--stats')) : null;
  const result = decide(findings, checks, notReviewed);
  const dirty = isDirty();
  const head = headSha();
  const fingerprint = worktreeFingerprint();

  const dir = stateDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, verdictFile(scope, { head, fingerprint })),
    JSON.stringify(
      { scope, head, fingerprint, base: opt('--base') ?? null, ...result, dirty, findings, checks, not_reviewed: notReviewed, stats, reviewed_at: new Date().toISOString() },
      null,
      2,
    ),
  );

  console.log(renderReport({ scope, result, findings, checks, route, stats, warnings, dirty, notReviewed }));
  if (scope === 'branch' && result.verdict === 'PASS') {
    const pr = join(dir, `${head}.pr.md`);
    writeFileSync(pr, renderPrDraft({ findings, checks, route, entries, warnings }));
    console.log(`\nPR description draft: ${pr}\n  gh pr create --body-file "${pr}"`);
  }
  if (scope === 'uncommitted' && result.verdict === 'PASS') {
    console.log('\nThe working tree passes. Before opening a PR: commit, then run with --scope branch (cached reviews make it quick).');
  }
}
