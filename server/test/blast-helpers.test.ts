import { describe, it, expect } from 'vitest';
import { buildSummary, countBlast, toBlastRadius, toPrHistory } from '../src/modules/blast/helpers.js';
import type { BlastResult } from '../src/modules/repo-intel/index.js';

const caller = (file: string, viaSymbol: string, rank: number, line = 1, symbol = `fn_${file}`) => ({
  file, symbol, viaSymbol, line, rank,
});

const base: BlastResult = {
  changedSymbols: [
    { name: 'A', file: 'lib/a.ts', kind: 'function' },
    { name: 'B', file: 'lib/b.ts', kind: 'function' },
  ],
  callers: [
    caller('x.ts', 'A', 1),
    caller('y.ts', 'B', 9),
    caller('z.ts', 'A', 5),
  ],
  impactedEndpoints: [],
  factsByFile: {
    'x.ts': { endpoints: ['GET /x'], crons: ['job:a'] },
    'z.ts': { endpoints: ['GET /x', 'GET /z'], crons: ['job:a'] },
  },
};

describe('toBlastRadius', () => {
  it('groups, orders callers by rank and groups by max rank', () => {
    const r = toBlastRadius(base);
    expect(r.downstream.map((d) => d.symbol)).toEqual(['B', 'A']);
    expect(r.downstream[1]!.callers.map((c) => c.file)).toEqual(['z.ts', 'x.ts']);
    expect(r.changed_symbols[0]).toEqual({ name: 'A', file: 'lib/a.ts', kind: 'function' });
    expect(r.downstream[1]!.callers[0]).toEqual({ name: 'fn_z.ts', file: 'z.ts', line: 1 });
  });

  it('unions and dedups endpoints/crons; [] without factsByFile', () => {
    const a = toBlastRadius(base).downstream.find((d) => d.symbol === 'A')!;
    expect(a.endpoints_affected.sort()).toEqual(['GET /x', 'GET /z']);
    expect(a.crons_affected).toEqual(['job:a']);
    const { factsByFile: _f, ...noFacts } = base;
    for (const d of toBlastRadius(noFacts).downstream) {
      expect(d.endpoints_affected).toEqual([]);
      expect(d.crons_affected).toEqual([]);
    }
  });

  it('passes every facade caller through, even one in the declaration file (the facade filters)', () => {
    const r = toBlastRadius({ ...base, callers: [caller('lib/a.ts', 'A', 2)] });
    expect(r.downstream).toEqual([
      { symbol: 'A', callers: [{ name: 'fn_lib/a.ts', file: 'lib/a.ts', line: 1 }], endpoints_affected: [], crons_affected: [] },
    ]);
  });

  it('keeps first-seen order on rank ties', () => {
    const r = toBlastRadius({
      ...base,
      callers: [caller('p.ts', 'B', 3), caller('q.ts', 'A', 3)],
    });
    expect(r.downstream.map((d) => d.symbol)).toEqual(['B', 'A']);
  });

  it('empty input → empty downstream', () => {
    const r = toBlastRadius({ changedSymbols: [], callers: [], impactedEndpoints: [] });
    expect(r).toEqual({ changed_symbols: [], downstream: [] });
  });
});

describe('buildSummary', () => {
  it('healthy and degraded formats', () => {
    const counts = countBlast(toBlastRadius(base));
    expect(counts).toEqual({ symbols: 2, callers: 3, endpoints: 2, crons: 1 });
    expect(buildSummary(counts, false, null)).toBe('2 changed symbols · 3 callers · 2 endpoints · 1 crons');
    expect(buildSummary(counts, true, 'index_partial')).toBe(
      '2 changed symbols · 3 callers · 2 endpoints · 1 crons · index degraded: index_partial',
    );
  });
});

describe('toPrHistory', () => {
  const pr = (number: number, merged_at: string | null, title = `PR ${number}`) => ({
    number, title, merged_at, author: 'a',
  });

  it('dedupes across paths, collects unique overlap, drops current + unmerged, sorts, caps', () => {
    const out = toPrHistory(
      [
        { path: 'a.ts', prs: [pr(1, '2026-01-01'), pr(2, '2026-03-01'), pr(9, '2026-04-01'), pr(5, null)] },
        { path: 'b.ts', prs: [pr(1, '2026-01-01'), pr(1, '2026-01-01'), pr(3, '2026-02-01')] },
        { path: 'c.ts', prs: [pr(3, '2026-02-01')] },
      ],
      9,
      2,
    );
    expect(out.history.map((h) => h.pr_number)).toEqual([3, 1]); // overlap 2 each; 3 is newer; 2 capped out
    expect(out.history[0]).toMatchObject({ files_overlap: ['b.ts', 'c.ts'], notes: '' });
    expect(out.history[1]!.files_overlap).toEqual(['a.ts', 'b.ts']);
  });

  it('returns an empty history for empty input', () => {
    expect(toPrHistory([], 1, 5)).toEqual({ history: [] });
    expect(toPrHistory([{ path: 'a.ts', prs: [] }], 1, 5)).toEqual({ history: [] });
  });
});
