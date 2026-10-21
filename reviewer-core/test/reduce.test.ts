/**
 * Map-reduce helpers: `sliceDiff` must hand each map chunk exactly its own
 * file's section, and `reduceReviews` must merge partials deterministically.
 */
import { describe, it, expect } from 'vitest';
import type { Review, UnifiedDiff } from '@devdigest/shared';
import { reduceReviews, sliceDiff } from '../src/review/reduce.js';

const RAW = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1 +1 @@',
  '+A',
  'diff --git a/lib/src/a.ts b/lib/src/a.ts',
  '--- a/lib/src/a.ts',
  '+++ b/lib/src/a.ts',
  '@@ -1 +1 @@',
  '+LIB',
  'diff --git a/src/a.ts.orig b/src/a.ts.orig',
  '--- a/src/a.ts.orig',
  '+++ b/src/a.ts.orig',
  '@@ -1 +1 @@',
  '+ORIG',
].join('\n');

const diff: UnifiedDiff = {
  raw: RAW,
  files: ['src/a.ts', 'lib/src/a.ts', 'src/a.ts.orig'].map((path) => ({
    path,
    additions: 1,
    deletions: 0,
    hunks: [],
  })),
};

describe('sliceDiff', () => {
  it('captures only the exact file, not paths that merely contain it', () => {
    const slice = sliceDiff(diff, 'src/a.ts');
    expect(slice).toContain('+A');
    expect(slice).not.toContain('+LIB');
    expect(slice).not.toContain('+ORIG');
  });

  it('captures a nested path on its own', () => {
    const slice = sliceDiff(diff, 'lib/src/a.ts');
    expect(slice).toContain('+LIB');
    expect(slice).not.toContain('+A\n');
  });

  it('follows a rename to the new (b/) path', () => {
    const renamed: UnifiedDiff = {
      raw: 'diff --git a/old.ts b/new.ts\nsimilarity index 90%\n@@ -1 +1 @@\n+X',
      files: [{ path: 'new.ts', additions: 1, deletions: 0, hunks: [] }],
    };
    expect(sliceDiff(renamed, 'new.ts')).toContain('+X');
  });
});

describe('reduceReviews', () => {
  const r = (verdict: Review['verdict'], score: number, n: number): Review => ({
    verdict,
    score,
    summary: `${verdict}`,
    findings: Array.from({ length: n }, (_, i) => ({
      id: `${verdict}-${i}`,
      severity: 'WARNING',
      category: 'bug',
      title: 't',
      file: 'f.ts',
      start_line: 1,
      end_line: 1,
      rationale: 'r',
      confidence: 0.9,
    })),
  });

  it('concatenates findings, takes the worst verdict and the mean score', () => {
    const merged = reduceReviews([r('approve', 90, 1), r('request_changes', 50, 2)]);
    expect(merged.findings).toHaveLength(3);
    expect(merged.verdict).toBe('request_changes');
    expect(merged.score).toBe(70);
  });

  it('returns a single partial unchanged', () => {
    const only = r('comment', 80, 1);
    expect(reduceReviews([only])).toBe(only);
  });
});
