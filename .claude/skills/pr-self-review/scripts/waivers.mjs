#!/usr/bin/env node
// Applies .pr-self-review-waivers.json to the confirmed findings.
//
//   waivers.mjs --findings FILE.json [--waivers FILE.json] [--today YYYY-MM-DD]
//   → {"findings": [... + waived/waiver], "warnings": [...]}
//
// A waiver: {file, rule, skill?, reason, expires, author}. `file` may be a glob.
// It must have a reason, a future `expires`, and at most MAX_DAYS ahead.
// Deterministic findings (migrations, typecheck, ...) are never waivable.

import { existsSync, readFileSync } from 'node:fs';
import { matchesAny } from './lib/glob.mjs';

export const MAX_DAYS = 30;
const DAY = 86_400_000;

export function validateWaivers(waivers, today = new Date()) {
  const valid = [];
  const warnings = [];
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  waivers.forEach((w, i) => {
    const id = `waiver #${i + 1} (${w.file ?? '?'} / ${w.rule ?? '?'})`;
    const exp = Date.parse(w.expires ?? '');
    if (!w.file || !w.rule) warnings.push(`${id} ignored: "file" and "rule" are required`);
    else if (!String(w.reason ?? '').trim()) warnings.push(`${id} ignored: "reason" is required`);
    else if (Number.isNaN(exp)) warnings.push(`${id} ignored: "expires" must be YYYY-MM-DD`);
    else if (exp < now) warnings.push(`${id} ignored: expired ${w.expires}`);
    else if (exp - now > MAX_DAYS * DAY) warnings.push(`${id} ignored: "expires" is more than ${MAX_DAYS} days ahead`);
    else valid.push(w);
  });
  return { valid, warnings };
}

export function applyWaivers(findings, waivers, today = new Date()) {
  const { valid, warnings } = validateWaivers(waivers, today);
  const out = findings.map((f) => {
    if (f.severity !== 'CRITICAL' || f.deterministic) return f;
    const w = valid.find(
      (x) => matchesAny(f.file, [x.file]) && x.rule === f.rule && (!x.skill || x.skill === f.skill),
    );
    return w ? { ...f, waived: true, waiver: { reason: w.reason, expires: w.expires, author: w.author ?? null } } : f;
  });
  return { findings: out, warnings };
}

if (process.argv[1] && process.argv[1].endsWith('waivers.mjs')) {
  const args = process.argv.slice(2);
  const opt = (n, d) => (args.indexOf(n) === -1 ? d : args[args.indexOf(n) + 1]);
  const findings = JSON.parse(readFileSync(opt('--findings'), 'utf8'));
  const wf = opt('--waivers', '.pr-self-review-waivers.json');
  const waivers = existsSync(wf) ? JSON.parse(readFileSync(wf, 'utf8')) : [];
  const today = opt('--today') ? new Date(opt('--today')) : new Date();
  console.log(JSON.stringify(applyWaivers(findings, waivers, today), null, 2));
}
