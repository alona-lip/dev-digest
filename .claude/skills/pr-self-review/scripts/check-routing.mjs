#!/usr/bin/env node
// Keeps routing.json honest. Fails when:
//  - a skill in .claude/skills/ is in no bucket (core or extra) and not `excluded`,
//    or routing.json names a skill that does not exist;
//  - a bucket listed in `required_core` lost (or gained) a core skill — the
//    surface → skills requirement must not drift silently;
//  - a check named by a bucket or in `checks` has no implementation, or an
//    implemented check has no trigger.
//
//   node check-routing.mjs [--skills-dir DIR] [--routing FILE]

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_NAMES } from './checks.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const routedSkills = (routing) =>
  new Set(
    routing.buckets.flatMap((b) => [
      ...b.core,
      ...(b.overrides ?? []).flatMap((o) => o.core),
      ...(b.extras ?? []).flatMap((e) => e.skills),
    ]),
  );

export function checkRouting(skillNames, routing, implementedChecks = CHECK_NAMES) {
  const routed = routedSkills(routing);
  const excluded = new Set(routing.excluded ?? []);
  const known = new Set(skillNames);
  const problems = [];

  for (const s of skillNames) {
    if (!routed.has(s) && !excluded.has(s)) problems.push(`skill "${s}" is in no bucket and not excluded in routing.json`);
  }
  for (const s of new Set([...routed, ...excluded])) {
    if (!known.has(s)) problems.push(`routing.json names "${s}" but .claude/skills/${s}/SKILL.md does not exist`);
  }
  for (const s of routed) {
    if (excluded.has(s)) problems.push(`skill "${s}" is both routed and excluded`);
  }

  const names = routing.buckets.map((b) => b.name);
  if (new Set(names).size !== names.length) problems.push('bucket names must be unique');
  for (const [bucket, required] of Object.entries(routing.required_core ?? {})) {
    const b = routing.buckets.find((x) => x.name === bucket);
    if (!b) { problems.push(`required_core names bucket "${bucket}" which does not exist`); continue; }
    const got = [...b.core].sort().join(', ');
    const want = [...required].sort().join(', ');
    if (got !== want) problems.push(`bucket "${bucket}" core is [${got}] but required_core says [${want}]`);
  }

  const triggered = new Set(Object.keys(routing.checks ?? {}));
  const implemented = new Set(implementedChecks);
  for (const b of routing.buckets) {
    for (const c of b.checks ?? []) {
      if (!triggered.has(c)) problems.push(`bucket "${b.name}" lists check "${c}" which has no trigger in routing.json checks`);
    }
  }
  for (const c of triggered) if (!implemented.has(c)) problems.push(`check "${c}" has a trigger but no implementation in checks.mjs`);
  for (const c of implemented) if (!triggered.has(c)) problems.push(`check "${c}" is implemented but never triggered (add it to routing.json checks)`);

  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n, d) => (args.indexOf(n) === -1 ? d : args[args.indexOf(n) + 1]);
  const dir = resolve(opt('--skills-dir', join(here, '..', '..')));
  const routing = JSON.parse(readFileSync(opt('--routing', join(here, '..', 'routing.json')), 'utf8'));
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'SKILL.md')))
    .map((d) => d.name);
  const problems = checkRouting(names, routing);
  if (problems.length) {
    console.error(problems.map((p) => `✗ ${p}`).join('\n'));
    process.exit(1);
  }
  console.log(`routing.json OK: ${names.length} skills, ${routing.buckets.length} buckets, ${Object.keys(routing.checks).length} checks`);
}
