/**
 * PR-list rollup helpers (`modules/pulls/status.ts`) — the pure derivation that
 * decides each PR's review STATUS and tallies its FINDINGS for the list. The DB
 * `status` column holds GitHub's merge state; the review status
 * (needs_review / reviewed / stale) is derived here from head vs lastReviewedSha
 * + age, so it gets unit coverage independent of the route's queries.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveReviewStatus,
  latestReviewPerAgent,
  rollupSeverities,
  sumRunCosts,
  sumSeverityCounts,
  STALE_DAYS,
} from '../src/modules/pulls/status.js';

const DAY = 86_400_000;
const now = Date.UTC(2026, 5, 11);

describe('deriveReviewStatus', () => {
  it('needs_review when never reviewed, or when head moved since the last review', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: null, headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'old', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
  });

  it('reviewed when the current head was reviewed and the PR is recent', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now - DAY), now }),
    ).toBe('reviewed');
  });

  it('stale when the current head was reviewed but the PR is older than STALE_DAYS', () => {
    expect(
      deriveReviewStatus({
        ghStatus: 'open',
        lastReviewedSha: 'abc',
        headSha: 'abc',
        updatedAt: new Date(now - (STALE_DAYS + 1) * DAY),
        now,
      }),
    ).toBe('stale');
  });

  it('keeps merged/closed regardless of review state', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'merged', lastReviewedSha: null, headSha: 'abc', updatedAt: null, now }),
    ).toBe('merged');
    expect(
      deriveReviewStatus({ ghStatus: 'closed', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('closed');
  });
});

describe('rollupSeverities', () => {
  it('tallies findings into CRITICAL / WARNING / SUGGESTION buckets (ignores unknown)', () => {
    expect(
      rollupSeverities([
        { severity: 'CRITICAL' },
        { severity: 'CRITICAL' },
        { severity: 'WARNING' },
        { severity: 'SUGGESTION' },
        { severity: 'WEIRD' },
      ]),
    ).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 1 });
  });

  it('is all-zero for no findings', () => {
    expect(rollupSeverities([])).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
  });
});

describe('sumRunCosts', () => {
  it('sums every run, not just the newest one', () => {
    expect(sumRunCosts([{ costUsd: 0.002 }, { costUsd: 0.003 }, { costUsd: 0.005 }])).toBeCloseTo(
      0.01,
      10,
    );
  });

  it('is null (not 0) for a PR with no successful runs — the column renders "—"', () => {
    expect(sumRunCosts([])).toBeNull();
  });

  it('is null when runs exist but every cost is unknown — unknown is not free', () => {
    expect(sumRunCosts([{ costUsd: null }, { costUsd: null }])).toBeNull();
  });

  it('sums the priced runs and ignores the unpriced ones', () => {
    expect(sumRunCosts([{ costUsd: 0.004 }, { costUsd: null }])).toBeCloseTo(0.004, 10);
  });

  it('keeps a genuine zero as 0, distinct from null', () => {
    expect(sumRunCosts([{ costUsd: 0 }])).toBe(0);
  });
});

describe('latestReviewPerAgent', () => {
  // Newest-first, as the route's ORDER BY created_at DESC hands them over.
  const rv = (id: string, prId: string, agentId: string | null) => ({ id, prId, agentId });

  it('keeps only the newest review per agent — a re-run replaces, not adds', () => {
    const out = latestReviewPerAgent([
      rv('a2', 'pr1', 'A'),
      rv('b1', 'pr1', 'B'),
      rv('a1', 'pr1', 'A'),
    ]);
    expect(out.get('pr1')?.map((r) => r.id)).toEqual(['a2', 'b1']);
  });

  it('puts reviews with no agent into one shared bucket per PR', () => {
    const out = latestReviewPerAgent([
      rv('n2', 'pr1', null),
      rv('a1', 'pr1', 'A'),
      rv('n1', 'pr1', null),
    ]);
    expect(out.get('pr1')?.map((r) => r.id)).toEqual(['n2', 'a1']);
  });

  it('keeps PRs independent even when the same agent reviewed both', () => {
    const out = latestReviewPerAgent([
      rv('x2', 'pr1', 'A'),
      rv('y1', 'pr2', 'A'),
      rv('x1', 'pr1', 'A'),
    ]);
    expect(out.get('pr1')?.map((r) => r.id)).toEqual(['x2']);
    expect(out.get('pr2')?.map((r) => r.id)).toEqual(['y1']);
  });

  it('returns an empty map for no reviews', () => {
    expect(latestReviewPerAgent([]).size).toBe(0);
  });
});

describe('sumSeverityCounts', () => {
  it('sums per-agent tallies', () => {
    expect(
      sumSeverityCounts([
        { CRITICAL: 1, WARNING: 2, SUGGESTION: 0 },
        { CRITICAL: 0, WARNING: 1, SUGGESTION: 3 },
      ]),
    ).toEqual({ CRITICAL: 1, WARNING: 3, SUGGESTION: 3 });
  });

  it('returns all zeros for an empty list (reviewed, clean — not null)', () => {
    expect(sumSeverityCounts([])).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
  });
});
