import { describe, it, expect } from 'vitest';
import { buildSummary, countBlast, toBlastRadius } from '../src/modules/blast/helpers.js';
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
    caller('lib/a.ts', 'A', 99), // declaration file: dropped
  ],
  impactedEndpoints: [],
  factsByFile: {
    'x.ts': { endpoints: ['GET /x'], crons: ['job:a'] },
    'z.ts': { endpoints: ['GET /x', 'GET /z'], crons: ['job:a'] },
  },
};

describe('toBlastRadius', () => {
  it('groups, orders callers by rank and groups by max rank, drops declaration file', () => {
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
