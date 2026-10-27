import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import type { RepoBasics } from '../src/modules/repo-intel/repository.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';

/**
 * T1.4 — Facade degraded contract (acceptance #10).
 *
 * When `repoIntelEnabled=false` (opt-out; the default is now ON), every facade
 * method MUST return a safe degraded value WITHOUT throwing. Consumers (run-executor,
 * blast, hooks) downgrade to their pre-T1.3 behavior on these returns; if any
 * method threw or returned malformed shape, every consumer would crash.
 *
 * No Postgres, no clone. The service's `repo` (RepoIntelRepository) is patched
 * to return null/[] so we exercise the degraded paths cleanly.
 */

function buildDegradedService(opts: {
  flag: boolean;
  basics?: RepoBasics | null;
  indexStateRow?: IndexState | null;
  repoOverrides?: Record<string, unknown>;
}): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: opts.flag },
    db: {} as never,
    // codeIndex is reached by getBlastRadius; we stub minimal behaviour.
    codeIndex: {
      symbols: async () => [],
      references: async () => [],
    } as never,
  } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    getRepoBasics: async () => opts.basics ?? null,
    tryGetIndexState: async () => opts.indexStateRow ?? null,
    getCachedSymbols: async () => [],
    getCachedSymbolsForFiles: async () => [],
    getCachedReferencesTo: async () => [],
    ...opts.repoOverrides,
  };
  return svc;
}

describe('RepoIntel facade — degraded contract (flag off)', () => {
  it('getUnresolvedReferences → [] when repoIntelEnabled=false', async () => {
    const svc = buildDegradedService({ flag: false });
    await expect(svc.getUnresolvedReferences('r1', ['a.ts'])).resolves.toEqual([]);
  });

  it('getCallerSignatures → [] when repoIntelEnabled=false', async () => {
    const svc = buildDegradedService({ flag: false });
    await expect(svc.getCallerSignatures('r1', ['a.ts'])).resolves.toEqual([]);
  });

  it('getBlastRadius → degraded-but-valid shape (never throws)', async () => {
    const svc = buildDegradedService({ flag: false, basics: null });
    const blast = await svc.getBlastRadius('r1', ['a.ts']);
    // Shape (every key present, arrays where arrays go) — consumers assume this.
    expect(Array.isArray(blast.changedSymbols)).toBe(true);
    expect(Array.isArray(blast.callers)).toBe(true);
    expect(Array.isArray(blast.impactedEndpoints)).toBe(true);
    expect(blast.degraded).toBe(true);
    // reason is one of the documented DegradedReason values
    expect(['flag_off', 'no_data', 'index_failed', 'index_partial', 'repo_too_large'])
      .toContain(blast.reason);
  });

  it('getIndexState → degraded row (never throws) when no row exists', async () => {
    const svc = buildDegradedService({ flag: false, indexStateRow: null });
    const state = await svc.getIndexState('r1');
    // Always-present fields the UI / dashboard rely on (client bind).
    expect(state.repoId).toBe('r1');
    expect(state.status).toBe('degraded');
    expect(state.filesIndexed).toBe(0);
    expect(state.filesSkipped).toBe(0);
    expect(state.lastIndexedSha).toBe(''); // empty string, not undefined — JSON-safe
    expect(state.indexerVersion).toBeGreaterThanOrEqual(1);
    expect(state.updatedAt instanceof Date).toBe(true);
    expect(state.degraded).toBe(true);
  });

  it('getRepoMap → degraded ({ text:"", tokens:0, cached:false, degraded:true })', async () => {
    const svc = buildDegradedService({ flag: false });
    const map = await svc.getRepoMap('r1');
    expect(map.text).toBe('');
    expect(map.tokens).toBe(0);
    expect(map.cached).toBe(false);
    expect(map.degraded).toBe(true);
  });

  it('getFileRank / getSymbolsInFiles / getConventionSamples / getTopFilesByRank / getCriticalPaths → []', async () => {
    const svc = buildDegradedService({ flag: false });
    await expect(svc.getFileRank('r1', ['a.ts'])).resolves.toEqual([]);
    await expect(svc.getSymbolsInFiles('r1', ['a.ts'])).resolves.toEqual([]);
    await expect(svc.getConventionSamples('r1', 12)).resolves.toEqual([]);
    await expect(svc.getTopFilesByRank('r1', 7)).resolves.toEqual([]);
    await expect(svc.getCriticalPaths('r1')).resolves.toEqual([]);
  });

  it('indexRepo / refreshIndex → degraded T1 skeleton (never throws)', async () => {
    const svc = buildDegradedService({ flag: false });
    const a = await svc.indexRepo('r1');
    const b = await svc.refreshIndex('r1');
    expect(a.status).toBe('degraded');
    expect(b.status).toBe('degraded');
    expect(a.filesIndexed).toBe(0);
    expect(b.filesIndexed).toBe(0);
  });
});

describe('RepoIntel facade — degraded contract (flag on, but no data)', () => {
  it('getCallerSignatures with no clone → [] (graceful degrade, no throw)', async () => {
    const svc = buildDegradedService({ flag: true, basics: { id: 'r1', owner: 'a', name: 'b', defaultBranch: 'main', clonePath: null } });
    await expect(svc.getCallerSignatures('r1', ['a.ts'])).resolves.toEqual([]);
  });

  it('getUnresolvedReferences with no clone → []', async () => {
    const svc = buildDegradedService({ flag: true, basics: { id: 'r1', owner: 'a', name: 'b', defaultBranch: 'main', clonePath: null } });
    await expect(svc.getUnresolvedReferences('r1', ['a.ts'])).resolves.toEqual([]);
  });

  it('getCallerSignatures with empty changedFiles → []', async () => {
    const svc = buildDegradedService({ flag: true, basics: { id: 'r1', owner: 'a', name: 'b', defaultBranch: 'main', clonePath: '/tmp' } });
    await expect(svc.getCallerSignatures('r1', [])).resolves.toEqual([]);
  });
});

const stateRow = (over: Partial<IndexState>): IndexState => ({
  repoId: 'r1',
  status: 'full',
  filesIndexed: 1,
  filesSkipped: 0,
  durationMs: 0,
  lastIndexedSha: 'abc',
  indexerVersion: 1,
  updatedAt: new Date(0),
  ...over,
});

describe('RepoIntel facade — getBlastRadius reasons', () => {
  it('flag off → flag_off', async () => {
    const svc = buildDegradedService({ flag: false });
    expect(await svc.getBlastRadius('r1', ['a.ts'])).toMatchObject({ degraded: true, reason: 'flag_off' });
  });

  it('flag on, no state row → no_data', async () => {
    const svc = buildDegradedService({ flag: true, indexStateRow: null });
    expect(await svc.getBlastRadius('r1', ['a.ts'])).toMatchObject({ degraded: true, reason: 'no_data' });
  });

  it('state failed → index_failed', async () => {
    const svc = buildDegradedService({
      flag: true,
      indexStateRow: stateRow({ status: 'failed', degraded: true, degradedReason: 'index_failed' }),
    });
    expect(await svc.getBlastRadius('r1', ['a.ts'])).toMatchObject({ degraded: true, reason: 'index_failed' });
  });

  it('partial index with no symbols (early return) → degraded index_partial', async () => {
    const svc = buildDegradedService({
      flag: true,
      indexStateRow: stateRow({ status: 'partial' }),
      repoOverrides: { getSymbolRows: async () => [] },
    });
    expect(await svc.getBlastRadius('r1', ['a.ts'])).toMatchObject({
      degraded: true,
      reason: 'index_partial',
      changedSymbols: [],
    });
  });

  it('full index with no symbols → healthy', async () => {
    const svc = buildDegradedService({
      flag: true,
      indexStateRow: stateRow({ status: 'full' }),
      repoOverrides: { getSymbolRows: async () => [] },
    });
    const r = await svc.getBlastRadius('r1', ['a.ts']);
    expect(r.degraded).toBe(false);
    expect(r.reason).toBeUndefined();
  });

  it('partial index with symbols → degraded index_partial; cap applies per symbol', async () => {
    const sym = (name: string) => ({ name, path: 'lib.ts', kind: 'function' });
    const callersA = Array.from({ length: 25 }, (_, i) => ({
      fromPath: `a${i}.ts`, toSymbol: 'A', line: i + 1, rank: 100 - i,
    }));
    const callersB = [0, 1, 2].map((i) => ({ fromPath: `b${i}.ts`, toSymbol: 'B', line: 1, rank: 1 + i }));
    const svc = buildDegradedService({
      flag: true,
      indexStateRow: stateRow({ status: 'partial' }),
      repoOverrides: {
        getSymbolRows: async (_id: string, files: string[]) => (files.includes('lib.ts') ? [sym('A'), sym('B')] : []),
        getResolvedCallers: async () => [...callersA, ...callersB],
        getFileFacts: async () => [],
      },
    });
    const r = await svc.getBlastRadius('r1', ['lib.ts']);
    expect(r).toMatchObject({ degraded: true, reason: 'index_partial' });
    expect(r.callers.filter((c) => c.viaSymbol === 'A')).toHaveLength(20);
    expect(r.callers.filter((c) => c.viaSymbol === 'B')).toHaveLength(3);
  });

  it('flag on, empty changedFiles → healthy empty result (not degraded)', async () => {
    const svc = buildDegradedService({ flag: true, indexStateRow: null });
    const r = await svc.getBlastRadius('r1', []);
    expect(r).toMatchObject({ degraded: false, changedSymbols: [], callers: [] });
    expect(r.reason).toBeUndefined();
  });

  it('same-file references do not consume the per-symbol cap', async () => {
    const sameFile = Array.from({ length: 5 }, (_, i) => ({
      fromPath: 'lib.ts', toSymbol: 'A', line: i + 1, rank: 1000 - i,
    }));
    const cross = Array.from({ length: 22 }, (_, i) => ({
      fromPath: `x${i}.ts`, toSymbol: 'A', line: 1, rank: 100 - i,
    }));
    const svc = buildDegradedService({
      flag: true,
      indexStateRow: stateRow({ status: 'full' }),
      repoOverrides: {
        getSymbolRows: async (_id: string, files: string[]) =>
          files.includes('lib.ts') ? [{ name: 'A', path: 'lib.ts', kind: 'function' }] : [],
        getResolvedCallers: async () => [...sameFile, ...cross],
        getFileFacts: async () => [],
      },
    });
    const r = await svc.getBlastRadius('r1', ['lib.ts']);
    expect(r.callers).toHaveLength(20);
    expect(r.callers.every((c) => c.file !== 'lib.ts')).toBe(true);
  });
});
