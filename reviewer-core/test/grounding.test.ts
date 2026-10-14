/**
 * groundFindings — the cost of the gate must be bounded by the DIFF, not by
 * the line numbers the model reports: those are untrusted output.
 */
import { describe, it, expect } from 'vitest';
import type { Finding, UnifiedDiff } from '@devdigest/shared';
import { groundFindings } from '../src/grounding.js';

const diff: UnifiedDiff = {
  raw: '',
  files: [
    {
      path: 'src/a.ts',
      additions: 2,
      deletions: 0,
      hunks: [
        { file: 'src/a.ts', oldStart: 10, oldLines: 1, newStart: 10, newLines: 3, newLineNumbers: [10, 11, 12] },
      ],
    },
  ],
};

function finding(start_line: number, end_line: number): Finding {
  return {
    id: 'f',
    severity: 'WARNING',
    category: 'bug',
    title: 't',
    file: 'src/a.ts',
    start_line,
    end_line,
    rationale: 'r',
    confidence: 0.9,
  };
}

describe('groundFindings — model-supplied ranges', () => {
  it('keeps a huge range that covers a hunk line, without walking the range', () => {
    const t0 = Date.now();
    const res = groundFindings([finding(1, 1_000_000_000)], diff);
    expect(res.kept).toHaveLength(1);
    expect(Date.now() - t0).toBeLessThan(100);
  });

  it('drops a huge range that misses every hunk line, just as fast', () => {
    const t0 = Date.now();
    const res = groundFindings([finding(100, 1_000_000_000)], diff);
    expect(res.dropped).toHaveLength(1);
    expect(Date.now() - t0).toBeLessThan(100);
  });

  it('still accepts a reversed range (end before start)', () => {
    expect(groundFindings([finding(12, 11)], diff).kept).toHaveLength(1);
  });
});
