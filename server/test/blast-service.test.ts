import { describe, it, expect, vi } from 'vitest';
import { PrBlastRadius } from '@devdigest/shared';
import { BlastService, type BlastDeps } from '../src/modules/blast/service.js';
import { ExternalServiceError, NotFoundError } from '../src/platform/errors.js';
import type { BlastResult } from '../src/modules/repo-intel/index.js';
import type { PullRow, RepoRow } from '../src/db/rows.js';

const WS = 'ws-1';
const PULL = { id: 'pr-1', repoId: 'repo-1' } as unknown as PullRow;
const REPO = { id: 'repo-1' } as unknown as RepoRow;

const HEALTHY: BlastResult = {
  changedSymbols: [{ name: 'A', file: 'lib.ts', kind: 'function' }],
  callers: [{ file: 'r.ts', symbol: 'route', viaSymbol: 'A', line: 4, rank: 2 }],
  impactedEndpoints: ['GET /r'],
  factsByFile: { 'r.ts': { endpoints: ['GET /r'], crons: [] } },
  degraded: false,
};

function setup(
  result: BlastResult = HEALTHY,
  files: { diff?: string[]; github?: () => Promise<string[]> } = {},
) {
  const getBlastRadius = vi.fn(async () => result);
  const githubFiles = vi.fn(files.github ?? (async () => ['gh.ts']));
  const deps: BlastDeps = {
    reviews: {
      getPull: async (ws, id) => (ws === WS && id === PULL.id ? PULL : undefined),
      getRepo: async (id) => (id === REPO.id ? REPO : undefined),
    },
    diffFiles: async () => files.diff ?? ['lib.ts', 'other.ts'],
    githubFiles,
    repoIntel: { getBlastRadius },
  };
  const log = { info: vi.fn(), warn: vi.fn() };
  return { service: new BlastService(deps), getBlastRadius, githubFiles, log };
}

describe('BlastService.forPull', () => {
  it('reads the index once with repoId + the diff paths, parses, logs, reason null when healthy', async () => {
    const { service, getBlastRadius, log } = setup();
    const res = await service.forPull(WS, PULL.id, log);
    expect(getBlastRadius).toHaveBeenCalledTimes(1);
    expect(getBlastRadius).toHaveBeenCalledWith('repo-1', ['lib.ts', 'other.ts']);
    expect(() => PrBlastRadius.parse(res)).not.toThrow();
    expect(res).toMatchObject({ pr_id: 'pr-1', degraded: false, reason: null });
    expect(res.summary).toBe('1 changed symbols · 1 callers · 1 endpoints · 0 crons');
    expect(log.info).toHaveBeenCalledWith('blast: read from index', expect.objectContaining({ callers: 1 }));
  });

  it('passes a degraded facade result through unchanged', async () => {
    const { service } = setup({ ...HEALTHY, degraded: true, reason: 'index_partial' });
    const res = await service.forPull(WS, PULL.id);
    expect(res).toMatchObject({ degraded: true, reason: 'index_partial' });
    expect(res.summary).toContain('index degraded: index_partial');
    expect(() => PrBlastRadius.parse(res)).not.toThrow();
  });

  it('rejects a PR from another workspace', async () => {
    const { service, getBlastRadius } = setup();
    await expect(service.forPull('ws-2', PULL.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(getBlastRadius).not.toHaveBeenCalled();
  });

  it('uses the local diff when it has files and does not ask GitHub', async () => {
    const { service, githubFiles } = setup();
    await service.forPull(WS, PULL.id);
    expect(githubFiles).not.toHaveBeenCalled();
  });

  it('falls back to the GitHub file list when the local diff is empty', async () => {
    const { service, getBlastRadius } = setup(HEALTHY, { diff: [] });
    await service.forPull(WS, PULL.id);
    expect(getBlastRadius).toHaveBeenCalledWith('repo-1', ['gh.ts']);
  });

  it('empty diff + GitHub failure → logged 502, never a healthy empty map', async () => {
    const boom = new Error('401 Bad credentials');
    const { service, getBlastRadius, log } = setup(HEALTHY, {
      diff: [],
      github: async () => {
        throw boom;
      },
    });
    await expect(service.forPull(WS, PULL.id, log)).rejects.toBeInstanceOf(ExternalServiceError);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('changed files unavailable'), { err: boom });
    expect(getBlastRadius).not.toHaveBeenCalled();
  });
});
