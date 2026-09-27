import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { scoreFromFindings } from '../src/index.js';

/**
 * The score rule is public API: the review run stamps it on each review, and
 * the server's PR list recomputes it over every agent's findings. These tests
 * pin the rule itself — 100 − 35·CRITICAL − 12·WARNING − 3·SUGGESTION, zero
 * findings ⇒ 100, clamped to 0…100.
 */

function finding(severity: Finding['severity']): Finding {
  return {
    id: `f-${severity}`,
    severity,
    category: 'bug',
    title: `${severity} finding`,
    file: 'src/x.ts',
    start_line: 1,
    end_line: 1,
    rationale: 'because',
  } as Finding;
}

describe('scoreFromFindings', () => {
  it('no findings ⇒ 100', () => {
    expect(scoreFromFindings([])).toBe(100);
  });

  it('one of each severity ⇒ 100 − 35 − 12 − 3 = 50', () => {
    expect(
      scoreFromFindings([finding('CRITICAL'), finding('WARNING'), finding('SUGGESTION')]),
    ).toBe(50);
  });

  it('clamps at 0 rather than going negative', () => {
    expect(
      scoreFromFindings([finding('CRITICAL'), finding('CRITICAL'), finding('CRITICAL')]),
    ).toBe(0);
  });
});
