#!/usr/bin/env node
// Per-file review cache: .git/pr-self-review/cache/<ns>/<skill>/<key>.json
// key = sha256(skill version, blob hash of the file). Changing the skill's
// SKILL.md or severity.md changes the version, so its cache invalidates itself.
//
//   cache.mjs lookup --skill S [--ns review|verify] --files a b ...
//       → {"hit": {file: [findings]}, "miss": [files]}
//   cache.mjs store  --skill S [--ns review|verify] --files a b ... --findings FILE.json
//       → stores, per reviewed file, the findings whose `file` is that file
//          (a file with no findings is cached as "clean")
//   cache.mjs get|put --ns N --key K [--value FILE.json]     raw key/value, for checks

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blobSha, repoRoot, stateDir } from './lib/git.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function skillVersion(skill) {
  const root = repoRoot();
  const parts = [
    join(root, '.claude/skills', skill, 'SKILL.md'),
    join(here, '..', 'references', 'severity.md'),
    join(here, '..', 'references', 'reviewer-prompt.md'),
  ].map((f) => (existsSync(f) ? readFileSync(f, 'utf8') : ''));
  return sha256(parts.join('\0')).slice(0, 16);
}

const entry = (ns, skill, key) => join(stateDir(), 'cache', ns, skill, `${key}.json`);
const fileKey = (skill, file) => sha256(`${skillVersion(skill)}\0${blobSha(file)}`);

export function lookup(skill, files, ns = 'review') {
  const hit = {};
  const miss = [];
  for (const f of files) {
    const p = entry(ns, skill, fileKey(skill, f));
    if (existsSync(p)) hit[f] = JSON.parse(readFileSync(p, 'utf8'));
    else miss.push(f);
  }
  return { hit, miss };
}

export function store(skill, files, findings, ns = 'review') {
  for (const f of files) {
    const p = entry(ns, skill, fileKey(skill, f));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(findings.filter((x) => x.file === f)));
  }
}

export const rawPath = (ns, key) => join(stateDir(), 'cache', ns, '_raw', `${sha256(key)}.json`);

if (process.argv[1] && process.argv[1].endsWith('cache.mjs')) {
  const [cmd, ...args] = process.argv.slice(2);
  const opt = (n, d) => (args.indexOf(n) === -1 ? d : args[args.indexOf(n) + 1]);
  const list = (n) => {
    const i = args.indexOf(n);
    if (i === -1) return [];
    const out = [];
    for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) out.push(args[j]);
    return out;
  };
  const ns = opt('--ns', 'review');
  if (cmd === 'lookup') {
    console.log(JSON.stringify(lookup(opt('--skill'), list('--files'), ns)));
  } else if (cmd === 'store') {
    store(opt('--skill'), list('--files'), JSON.parse(readFileSync(opt('--findings'), 'utf8')), ns);
  } else if (cmd === 'get') {
    const p = rawPath(ns, opt('--key'));
    if (!existsSync(p)) process.exit(1);
    process.stdout.write(readFileSync(p, 'utf8'));
  } else if (cmd === 'put') {
    const p = rawPath(ns, opt('--key'));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, readFileSync(opt('--value'), 'utf8'));
  } else {
    console.error('usage: cache.mjs lookup|store|get|put ...');
    process.exit(2);
  }
}
