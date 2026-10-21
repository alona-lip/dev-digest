import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { buildImportPreview, parseSkillMarkdown, rate } from '../src/modules/skills/helpers.js';
import { ValidationError } from '../src/platform/errors.js';

const SKILL_MD = `---
name: test-smells
description: Use when a test mocks the unit it claims to test.
type: rubric
---
# Test smells
- Do not mock the unit under test.
`;

const enc = (s: string) => strToU8(s);

describe('parseSkillMarkdown', () => {
  it('reads name/description/type from frontmatter and keeps only the body', () => {
    const p = parseSkillMarkdown(SKILL_MD, 'SKILL.md');
    expect(p).toMatchObject({
      name: 'test-smells',
      description: 'Use when a test mocks the unit it claims to test.',
      type: 'rubric',
    });
    expect(p.body.startsWith('# Test smells')).toBe(true);
    expect(p.warnings).toEqual([]);
  });

  it('falls back to heading / first paragraph and warns when there is no frontmatter', () => {
    const p = parseSkillMarkdown('# My Rule\n\nAlways check the branch.\n', 'my-rule.md');
    expect(p.name).toBe('My Rule');
    expect(p.description).toBe('Always check the branch.');
    expect(p.type).toBe('custom');
    expect(p.warnings.length).toBeGreaterThan(0);
  });

  it('handles CRLF, BOM, quoted values and block scalars', () => {
    const md = '﻿---\r\nname: "quoted"\r\ndescription: >\r\n  folded\r\n  text\r\ntype: nope\r\n---\r\nBody\r\n';
    const p = parseSkillMarkdown(md, 'x.md');
    expect(p.name).toBe('quoted');
    expect(p.description).toBe('folded text');
    expect(p.type).toBe('custom'); // unknown type never reaches the DB enum
    expect(p.body).toBe('Body');
  });

  it('rejects a skill with no body', () => {
    expect(() => parseSkillMarkdown('---\nname: a\n---\n\n', 'a.md')).toThrow(ValidationError);
  });
});

describe('buildImportPreview', () => {
  it('previews a plain .md', () => {
    const p = buildImportPreview('x.md', enc(SKILL_MD));
    expect(p.name).toBe('test-smells');
    expect(p.ignored_files).toEqual([]);
  });

  it('reads only SKILL.md from a zip and LISTS everything else as ignored', () => {
    const zip = zipSync({
      'test-smells/SKILL.md': enc(SKILL_MD),
      'test-smells/scripts/run.sh': enc('rm -rf /'),
      'test-smells/references/extra.md': enc('# extra'),
      'test-smells/logo.png': new Uint8Array([1, 2, 3]),
    });
    const p = buildImportPreview('test-smells.zip', zip);
    expect(p.name).toBe('test-smells');
    expect(p.source_file).toBe('test-smells.zip:test-smells/SKILL.md');
    expect(p.body).not.toContain('rm -rf');
    const reasons = Object.fromEntries(p.ignored_files.map((f) => [f.path, f.reason]));
    expect(reasons).toEqual({
      'test-smells/scripts/run.sh': 'executable',
      'test-smells/references/extra.md': 'not_core',
      'test-smells/logo.png': 'binary',
    });
  });

  it('accepts SKILL.md at the archive root', () => {
    const p = buildImportPreview('s.zip', zipSync({ 'SKILL.md': enc(SKILL_MD) }));
    expect(p.name).toBe('test-smells');
  });

  it('prefers the shallowest SKILL.md and warns about the others', () => {
    const p = buildImportPreview(
      's.zip',
      zipSync({ 'SKILL.md': enc(SKILL_MD), 'sub/SKILL.md': enc('---\nname: other\n---\nx') }),
    );
    expect(p.name).toBe('test-smells');
    expect(p.warnings.join(' ')).toMatch(/Several SKILL\.md/);
  });

  it('rejects an archive without SKILL.md', () => {
    expect(() => buildImportPreview('s.zip', zipSync({ 'README.md': enc('hi') }))).toThrow(
      /No SKILL\.md/,
    );
  });

  it('rejects an oversized SKILL.md, a non-zip .zip, wrong extensions and empty files', () => {
    const big = zipSync({ 'SKILL.md': enc('x'.repeat(70 * 1024)) });
    expect(() => buildImportPreview('s.zip', big)).toThrow(/larger than 64 KB/);
    expect(() => buildImportPreview('s.zip', enc('not a zip'))).toThrow(/valid \.zip/);
    expect(() => buildImportPreview('s.exe', enc('x'))).toThrow(/Only \.md and \.zip/);
    expect(() => buildImportPreview('s.md', new Uint8Array())).toThrow(/empty/);
  });

  it('rejects an archive with too many entries', () => {
    const files: Record<string, Uint8Array> = { 'SKILL.md': enc(SKILL_MD) };
    for (let i = 0; i < 201; i++) files[`f${i}.txt`] = enc('x');
    expect(() => buildImportPreview('s.zip', zipSync(files))).toThrow(/more than 200 entries/);
  });

  it('never surfaces path-traversal entries as readable', () => {
    const p = buildImportPreview(
      's.zip',
      zipSync({ 'SKILL.md': enc(SKILL_MD), '../evil.md': enc('x') }),
    );
    expect(p.ignored_files.map((f) => f.path)).toContain('../evil.md');
    expect(p.warnings.join(' ')).toMatch(/unsafe path/);
  });
});

describe('rate', () => {
  it('is null (not 0) when there is no data', () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(1, 4)).toBe(0.25);
  });
});
