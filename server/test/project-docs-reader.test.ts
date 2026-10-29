import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { symlink, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FsProjectDocsReader } from '../src/adapters/project-docs/fs-reader.js';
import { cleanupClones, makeClone, writeFiles } from './helpers/project-context-fixtures.js';
import { parse as parseEnv } from 'dotenv';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONTEXT_GLOB, loadConfig } from '../src/platform/config.js';

const GLOB = '**/{specs,docs,insights}/**/*.md';
const MAX = 1_048_576;
const scope = { glob: GLOB, roots: ['.'] };
const readScope = { ...scope, maxBytes: MAX };

describe('FsProjectDocsReader (temp-dir clone, real symlinks)', () => {
  const reader = new FsProjectDocsReader();
  let clone: string;

  beforeEach(async () => {
    clone = await makeClone({
      'specs/a.md': '# a',
      'docs/b.md': '# b',
      'insights/c.md': '# c',
      'docs/nested/deep.md': '# deep',
      'e2e/docs/specs/x.md': '# x',
      'README.md': '# readme',
      'docs/notes.txt': 'not markdown',
      'src/docs.md': '# file named docs, not a docs dir',
    });
  });
  afterEach(cleanupClones);

  const paths = async (s = scope) => (await reader.scan(clone, s)).map((d) => d.path);

  it('AC-1: scan returns exactly the .md files matching the configured glob, sorted by path', async () => {
    // contract: only .md files under a specs/docs/insights directory are documents
    expect(await paths()).toEqual([
      'docs/b.md',
      'docs/nested/deep.md',
      'e2e/docs/specs/x.md',
      'insights/c.md',
      'specs/a.md',
    ]);
  });

  it('AC-1: changing the glob changes the returned set', async () => {
    // contract: the glob comes from config; a broader glob picks up README.md and src/docs.md too
    const all = await paths({ glob: '**/*.md', roots: ['.'] });
    expect(all).toContain('README.md');
    expect(all).toContain('src/docs.md');
    expect(all).not.toContain('docs/notes.txt');
    // a narrower glob returns only specs
    expect(await paths({ glob: '**/specs/**/*.md', roots: ['.'] })).toEqual(['e2e/docs/specs/x.md', 'specs/a.md']);
  });

  it('AC-1: only files under the configured search roots are scanned', async () => {
    // contract: scanning starts at the configured roots, not the repository root
    expect(await paths({ glob: GLOB, roots: ['docs'] })).toEqual(['docs/b.md', 'docs/nested/deep.md']);
  });

  it('AC-2: includes hidden directories, always excludes node_modules and .git', async () => {
    await writeFiles(clone, {
      '.devdigest/specs/a.md': '# hidden',
      'node_modules/p/docs/b.md': '# dep',
      'pkg/node_modules/q/docs/d.md': '# nested dep',
      '.git/docs/c.md': '# git',
    });
    // contract: hidden dirs are scanned; node_modules/.git are excluded even with a catch-all glob
    for (const glob of [GLOB, '**/*.md']) {
      const found = await paths({ glob, roots: ['.'] });
      expect(found).toContain('.devdigest/specs/a.md');
      expect(found.some((p) => p.includes('node_modules'))).toBe(false);
      expect(found.some((p) => p.startsWith('.git/'))).toBe(false);
    }
  });

  it('AC-4: an empty file is listed with size 0 and reads as ok with empty text', async () => {
    await writeFiles(clone, { 'docs/empty.md': '' });
    const stat = (await reader.scan(clone, scope)).find((d) => d.path === 'docs/empty.md');
    // contract: an empty .md is a valid document of size 0
    expect(stat).toMatchObject({ path: 'docs/empty.md', size_bytes: 0 });
    expect(await reader.read(clone, 'docs/empty.md', readScope)).toMatchObject({ kind: 'ok', text: '', size_bytes: 0 });
  });

  it('AC-4: a file that is not valid UTF-8 reads as not_text', async () => {
    await writeFiles(clone, { 'docs/bin.md': new Uint8Array([0xff, 0xfe, 0x00, 0xc3, 0x28]) });
    // contract: binary / invalid UTF-8 is distinguishable from missing and from text
    expect(await reader.read(clone, 'docs/bin.md', readScope)).toEqual({ kind: 'not_text' });
  });

  it('AC-7: a valid path returns its text', async () => {
    // contract: a matching in-clone path is readable
    expect(await reader.read(clone, 'specs/a.md', readScope)).toMatchObject({ kind: 'ok', text: '# a' });
  });

  it('AC-7: traversal, absolute paths, excluded dirs and glob misses are not_found', async () => {
    await writeFiles(clone, { 'node_modules/p/docs/b.md': '# dep', '.git/docs/c.md': '# git' });
    const nf = { kind: 'not_found' };
    // contract: nothing outside the glob / inside excluded dirs / outside the clone is readable
    for (const p of [
      '../../etc/passwd',
      '../outside.md',
      'docs/../../outside.md',
      '/etc/passwd',
      'node_modules/p/docs/b.md',
      '.git/docs/c.md',
      'README.md', // glob miss
      'docs/notes.txt', // not .md
      'docs/missing.md', // does not exist
      '',
    ]) {
      expect(await reader.read(clone, p, readScope), p).toEqual(nf);
    }
  });

  it('AC-7: a symlinked file pointing outside the clone is not_found and not listed', async () => {
    const outside = await makeClone({ 'secret.md': '# secret' });
    await symlink(join(outside, 'secret.md'), join(clone, 'docs', 'link.md'));
    // contract: after resolving symlinks the file must lie inside the clone
    expect(await reader.read(clone, 'docs/link.md', readScope)).toEqual({ kind: 'not_found' });
    expect(await paths()).not.toContain('docs/link.md');
  });

  it('AC-7: a symlinked directory pointing outside the clone makes nothing readable or listed', async () => {
    const outside = await makeClone({ 'docs/secret.md': '# secret' });
    await symlink(outside, join(clone, 'docs', 'ext'));
    // contract: resolving symlinks must not let a document escape the clone
    expect(await reader.read(clone, 'docs/ext/docs/secret.md', readScope)).toEqual({ kind: 'not_found' });
    expect((await paths()).some((p) => p.includes('secret.md'))).toBe(false);
  });

  it('AC-7: a symlinked directory pointing into node_modules does not make a document readable', async () => {
    // AMBIGUOUS: AC-7 says "not excluded" and AC-2 "always exclude everything under node_modules/".
    // I read this as: the resolved target must not be in an excluded dir either.
    await writeFiles(clone, { 'node_modules/pkg/readme.md': '# dep readme' });
    await symlink(join(clone, 'node_modules', 'pkg'), join(clone, 'docs', 'nm'));
    expect(await reader.read(clone, 'docs/nm/readme.md', readScope)).toEqual({ kind: 'not_found' });
  });

  it('AC-7: a symlinked directory pointing into .git does not make a document readable', async () => {
    // AMBIGUOUS, same reading as above.
    await writeFiles(clone, { '.git/info/x.md': '# git internal' });
    await symlink(join(clone, '.git', 'info'), join(clone, 'docs', 'gitlink'));
    expect(await reader.read(clone, 'docs/gitlink/x.md', readScope)).toEqual({ kind: 'not_found' });
  });

  it('AC-7: a path through a file (ENOTDIR) or with an over-long segment is not found', async () => {
    expect(await reader.read(clone, 'docs/b.md/x.md', readScope)).toEqual({ kind: 'not_found' });
    expect(await reader.read(clone, `docs/${'a'.repeat(300)}/x.md`, readScope)).toEqual({ kind: 'not_found' });
  });

  it('AC-8: a file larger than 1 MB is listed with its size and read as too_large', async () => {
    const big = join(clone, 'docs', 'big.md');
    await writeFile(big, '');
    await truncate(big, 1_153_434); // ~1.1 MB
    const stat = (await reader.scan(clone, scope)).find((d) => d.path === 'docs/big.md');
    // contract: > 1 MB is reported too_large and its content is never returned
    expect(stat?.size_bytes).toBe(1_153_434);
    expect(await reader.read(clone, 'docs/big.md', readScope)).toEqual({ kind: 'too_large', size_bytes: 1_153_434 });
  });

  it('AC-8: a file of exactly 1 MB is not too_large ("larger than 1 MB" is the limit)', async () => {
    const f = join(clone, 'docs', 'edge.md');
    await writeFile(f, 'a'.repeat(MAX));
    // contract: the limit is strictly "larger than"
    expect(await reader.read(clone, 'docs/edge.md', readScope)).toMatchObject({ kind: 'ok', size_bytes: MAX });
  });
});

// ---------------------------------------------------------------------------
// SPEC-02: built-in default over the real repo layout (INSIGHTS.md files).
// macOS APFS is case-insensitive: names that differ only by case (`Docs/` vs
// `docs/`, `INSIGHTS.md` vs `INSIGHTS.MD`) live in separate clones below.
// ---------------------------------------------------------------------------
describe('FsProjectDocsReader — SPEC-02 built-in default (real repo layout)', () => {
  const reader = new FsProjectDocsReader();
  // "unset" built explicitly, never by spreading process.env (server/.env leaks via dotenv/config)
  const defaultGlob = loadConfig({ NODE_ENV: 'test', CONTEXT_GLOB: '' }).contextGlob;
  const dscope = { glob: defaultGlob, roots: ['.'] };
  const dread = { ...dscope, maxBytes: MAX };
  const body = (files: string[]) => Object.fromEntries(files.map((f) => [f, `# ${f}`]));
  const sorted = (xs: string[]) => [...xs].sort();
  const scanPaths = async (clone: string, s = dscope) => (await reader.scan(clone, s)).map((d) => d.path);

  /** listed <=> read().kind === 'ok' for every file of the fixture (AC-7). */
  const listedIffReadable = async (clone: string, all: string[], s = dscope, r = dread) => {
    const listed = new Set(await scanPaths(clone, s));
    for (const p of all) {
      const res = await reader.read(clone, p, r);
      // contract: one matching rule — a path is readable exactly when the scan lists it
      expect({ path: p, readable: res.kind === 'ok' }).toEqual({ path: p, readable: listed.has(p) });
    }
  };

  const MODULES = ['server', 'client', 'reviewer-core', 'e2e', 'mcp-server'].map((m) => `${m}/INSIGHTS.md`);
  // lowercase-directory fixture (AC-1, AC-2, AC-3, AC-14)
  const LISTED_LOWER = [
    'specs/x.md',
    'docs/y.md',
    'insights/c.md',
    'e2e/docs/specs/z.md',
    ...MODULES,
    'INSIGHTS.md',
    'a/b/insights.md',
    'c/Insights.md',
    '.devdigest/INSIGHTS.md',
  ];
  const NOT_LISTED_LOWER = [
    'notes/random.md',
    'README.md',
    'server/AGENTS.md',
    'notes/MY-INSIGHTS.md',
    'notes/insights-old.md',
    'insights.md.bak',
  ];
  // mixed-case-directory fixture: distinct file names so it also works on a case-insensitive FS
  const LISTED_MIXED = ['Docs/y2.md', 'SPECS/x2.md', 'Insights/c2.md'];
  // upper-case extension fixture: nothing here may be listed
  const UPPER_EXT = ['INSIGHTS.MD', 'docs/z.MD'];

  afterEach(cleanupClones);

  it('SPEC-02 AC-1: default lists specs/docs/insights directories at any depth, case-insensitively', async () => {
    const lower = await makeClone(body([...LISTED_LOWER, ...NOT_LISTED_LOWER]));
    const mixed = await makeClone(body(LISTED_MIXED));
    const found = await scanPaths(lower);
    // contract: lowercase specs/docs/insights dirs at any depth are listed (superset of the SPEC-01 default)
    for (const p of ['specs/x.md', 'docs/y.md', 'insights/c.md', 'e2e/docs/specs/z.md']) expect(found).toContain(p);
    // contract: Docs/, SPECS/, Insights/ directory segments are matched ignoring case
    expect(sorted(await scanPaths(mixed))).toEqual(sorted(LISTED_MIXED));
  });

  it('SPEC-02 AC-2/AC-14: default lists every <module>/INSIGHTS.md, root INSIGHTS.md and any-case file names', async () => {
    const clone = await makeClone(body([...LISTED_LOWER, ...NOT_LISTED_LOWER]));
    // AC-14 contract: the real built-in default (not a copy) must match <module>/INSIGHTS.md for all five modules
    expect(defaultGlob).toBe(DEFAULT_CONTEXT_GLOB);
    const found = await scanPaths(clone);
    for (const p of [...MODULES, 'INSIGHTS.md', 'a/b/insights.md', 'c/Insights.md']) expect(found).toContain(p);
  });

  it('SPEC-02 AC-3: default lists nothing else, incl. upper-case .MD', async () => {
    const clone = await makeClone(body([...LISTED_LOWER, ...NOT_LISTED_LOWER]));
    const upper = await makeClone(body([...UPPER_EXT, ...NOT_LISTED_LOWER]));
    // contract: exactly the AC-1/AC-2 files are listed, no other file
    expect(sorted(await scanPaths(clone))).toEqual(sorted(LISTED_LOWER));
    // contract: a non-lowercase extension (INSIGHTS.MD, docs/z.MD) is never a document
    expect(await scanPaths(upper)).toEqual([]);
  });

  it('SPEC-02 AC-4: INSIGHTS.md under node_modules/.git is excluded, in a hidden dir is listed', async () => {
    const clone = await makeClone(
      body(['node_modules/p/INSIGHTS.md', '.git/INSIGHTS.md', '.devdigest/INSIGHTS.md', 'pkg/node_modules/q/INSIGHTS.md']),
    );
    // contract: only the hidden-directory INSIGHTS.md is listed; excluded dirs stay excluded
    expect(await scanPaths(clone)).toEqual(['.devdigest/INSIGHTS.md']);
    expect(await reader.read(clone, 'node_modules/p/INSIGHTS.md', dread)).toEqual({ kind: 'not_found' });
    expect(await reader.read(clone, '.git/INSIGHTS.md', dread)).toMatchObject({ kind: 'not_found' });
    expect(await reader.read(clone, '.devdigest/INSIGHTS.md', dread)).toMatchObject({ kind: 'ok' });
  });

  it('SPEC-02 AC-4: excluded directories are excluded regardless of case (scan and read)', async () => {
    const clone = await makeClone(
      body(['Node_Modules/pkg/Docs/README.md', '.GIT/docs/x.md', 'Node_Modules/pkg/INSIGHTS.md', 'docs/ok.md']),
    );
    // contract: Node_Modules/ and .GIT/ are excluded like node_modules/ and .git/
    expect(await scanPaths(clone)).toEqual(['docs/ok.md']);
    for (const glob of [defaultGlob, '**/*.md']) {
      const s = { glob, roots: ['.'], maxBytes: MAX };
      for (const p of ['Node_Modules/pkg/Docs/README.md', '.GIT/docs/x.md', 'Node_Modules/pkg/INSIGHTS.md']) {
        expect(await reader.read(clone, p, s)).toEqual({ kind: 'not_found' });
      }
    }
  });

  it('SPEC-02 AC-7: read returns content for exactly the paths scan lists', async () => {
    const lower = [...LISTED_LOWER, ...NOT_LISTED_LOWER];
    const clones = [
      { clone: await makeClone(body(lower)), all: lower },
      { clone: await makeClone(body(LISTED_MIXED)), all: LISTED_MIXED },
      { clone: await makeClone(body([...UPPER_EXT, 'notes/random.md'])), all: [...UPPER_EXT, 'notes/random.md'] },
      {
        clone: await makeClone(body(['node_modules/p/INSIGHTS.md', '.git/INSIGHTS.md'])),
        all: ['node_modules/p/INSIGHTS.md', '.git/INSIGHTS.md'],
      },
    ];
    for (const { clone, all } of clones) await listedIffReadable(clone, all);
  });

  it('SPEC-02 AC-10: an explicit glob replaces the default under the same case rule', async () => {
    const files = ['SPECS/x.md', 'server/INSIGHTS.md', 'other/specs/y.MD', 'docs/d.md'];
    const clone = await makeClone(body(files));
    const specsOnly = { glob: '**/specs/**/*.md', roots: ['.'] };
    // contract: custom glob matches path names ignoring case; INSIGHTS.md is not added implicitly; .MD is refused
    expect(await scanPaths(clone, specsOnly)).toEqual(['SPECS/x.md']);
    expect(await reader.read(clone, 'SPECS/x.md', { ...specsOnly, maxBytes: MAX })).toMatchObject({ kind: 'ok' });
    expect(await reader.read(clone, 'server/INSIGHTS.md', { ...specsOnly, maxBytes: MAX })).toEqual({ kind: 'not_found' });
    expect(await reader.read(clone, 'other/specs/y.MD', { ...specsOnly, maxBytes: MAX })).toEqual({ kind: 'not_found' });
    // contract: a catch-all custom glob lists server/INSIGHTS.md
    expect(await scanPaths(clone, { glob: '**/*.md', roots: ['.'] })).toContain('server/INSIGHTS.md');
  });

  it('SPEC-02 AC-16: CONTEXT_GLOB set to the .env.example value scans identically to unset', async () => {
    const example = parseEnv(readFileSync(new URL('../.env.example', import.meta.url)));
    const fromExample = loadConfig({ NODE_ENV: 'test', CONTEXT_GLOB: example.CONTEXT_GLOB }).contextGlob;
    const lower = await makeClone(body([...LISTED_LOWER, ...NOT_LISTED_LOWER]));
    const mixed = await makeClone(body(LISTED_MIXED));
    // contract: an explicit default string behaves exactly like unset, incl. mixed-case dirs
    for (const clone of [lower, mixed]) {
      const unset = await reader.scan(clone, dscope);
      const explicit = await reader.scan(clone, { glob: fromExample, roots: ['.'] });
      expect(explicit).toEqual(unset);
    }
    expect(fromExample).toBe(defaultGlob);
  });
});
