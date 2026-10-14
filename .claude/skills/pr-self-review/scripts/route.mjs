#!/usr/bin/env node
// Changed files × routing.json → buckets → which skills review which files.
//
//   collect-diff.sh files | node route.mjs [--root DIR] [--routing FILE]
//   node route.mjs --print-table [--routing FILE]      # the human table → routing.md
//
// stdin: `STATUS<TAB>path` lines (R/C lines carry `old<TAB>new`).
// stdout: { buckets: {name: {files, skills: {skill: [files]}}}, caps, focus,
//           uncovered: [...], ignored: [...], deleted: [...] }
// A file lands in exactly one bucket: the first whose match/not accepts it.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesAny } from './lib/glob.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const ROUTING_PATH = join(here, '..', 'routing.json');

export function parseNameStatus(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const [status, ...paths] = line.split('\t');
    const path = paths[paths.length - 1];
    out.push({ status: status[0], path, oldPath: paths.length > 1 ? paths[0] : null });
  }
  return out;
}

const accepts = (rule, path) => matchesAny(path, rule.match) && !matchesAny(path, rule.not);

export function bucketOf(path, routing) {
  return routing.buckets.find((b) => accepts(b, path)) ?? null;
}

/** Skills for one file inside its bucket: core (or an override's core) + matching extras. */
export function skillsFor(path, bucket, readText = () => '') {
  const override = (bucket.overrides ?? []).find((o) => accepts(o, path));
  const skills = new Set(override ? override.core : bucket.core);
  for (const extra of bucket.extras ?? []) {
    if (!accepts(extra, path)) continue;
    if (extra.contains && !new RegExp(extra.contains).test(readText(path))) continue;
    extra.skills.forEach((s) => skills.add(s));
  }
  return [...skills];
}

export function route(entries, routing, readText = () => '') {
  const buckets = {};
  const uncovered = [];
  const ignored = [];
  const deleted = [];

  for (const { status, path } of entries) {
    if (status === 'D') { deleted.push(path); continue; }
    if (matchesAny(path, routing.ignore)) { ignored.push(path); continue; }
    const bucket = bucketOf(path, routing);
    if (!bucket) { uncovered.push(path); continue; }
    const b = (buckets[bucket.name] ??= { files: [], skills: {} });
    b.files.push(path);
    for (const s of skillsFor(path, bucket, readText)) (b.skills[s] ??= []).push(path);
  }
  return { buckets, caps: routing.caps ?? {}, focus: routing.focus ?? {}, uncovered, ignored, deleted };
}

const code = (xs) => xs.map((x) => `\`${x}\``).join(', ');

/** routing.md — generated, never hand-edited; a test keeps it equal to this output. */
export function renderTable(routing) {
  const L = [
    '<!-- Generated from routing.json by `node scripts/route.mjs --print-table > routing.md`. Do not edit by hand. -->',
    '',
    '# What pr-self-review checks',
    '',
    'Every changed file lands in exactly one bucket (first match wins). It is reviewed by the',
    "bucket's **core** skills plus every **extra** whose pattern matches it. Deterministic",
    'checks run when any file in their trigger list changed.',
    '',
    '| Bucket | Files | Core skills | Extras | Checks |',
    '|---|---|---|---|---|',
  ];
  for (const b of routing.buckets) {
    const files = code(b.match) + (b.not?.length ? `<br>except ${code(b.not)}` : '');
    const core = b.core.join(', ') + (b.overrides ?? []).map((o) => `<br>${code(o.match)} → only ${o.core.join(', ')}`).join('');
    const extras = (b.extras ?? [])
      .map((e) => {
        const where = e.label ?? (e.contains ? `files matching \`/${e.contains}/\`` : code(e.match));
        const cap = routing.caps?.[e.skills[0]] ? ` (max ${routing.caps[e.skills[0]]})` : '';
        return `${e.skills.join(', ')}${cap} → ${where.replace(/\|/g, '\\|')}`;
      })
      .join('<br>') || '—';
    L.push(`| **${b.name}**<br>${b.description} | ${files} | ${core} | ${extras} | ${b.checks?.join(', ') || '—'} |`);
  }
  L.push('| **Not covered** | anything not ignored and in no bucket (e2e, tests outside client, configs, scripts) | — | — | listed in the report |');
  L.push('', '## Deterministic checks', '', '| Check | Runs when changed |', '|---|---|');
  for (const [name, c] of Object.entries(routing.checks)) L.push(`| ${name} | ${code(c.on)} |`);
  L.push('', '## Ignored', '', code(routing.ignore), '', '## Excluded skills (not review skills)', '', code(routing.excluded), '');
  return L.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const i = args.indexOf(name);
    return i === -1 ? def : args[i + 1];
  };
  const routing = JSON.parse(readFileSync(opt('--routing', ROUTING_PATH), 'utf8'));
  if (args.includes('--print-table')) {
    process.stdout.write(renderTable(routing));
  } else {
    const root = resolve(opt('--root', process.cwd()));
    const readText = (p) => {
      const f = join(root, p);
      return existsSync(f) ? readFileSync(f, 'utf8') : '';
    };
    console.log(JSON.stringify(route(parseNameStatus(readFileSync(0, 'utf8')), routing, readText), null, 2));
  }
}
