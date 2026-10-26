import { describe, it, expect, vi } from 'vitest';
import { PrBlastRadius } from '@devdigest/shared';
import { BlastService, type BlastDeps } from '../src/modules/blast/service.js';
import { ExternalServiceError, NotFoundError } from '../src/platform/errors.js';
import { PRIOR_PRS_MAX_FILES } from '../src/modules/blast/constants.js';
import type { BlastResult } from '../src/modules/repo-intel/index.js';
import type { PathPullRequests } from '@devdigest/shared';
import type { PullRow, RepoRow } from '../src/db/rows.js';

const WS = 'ws-1';
const PULL = { id: 'pr-1', repoId: 'repo-1', number: 7, base: 'main' } as unknown as PullRow;
const REPO = { id: 'repo-1', owner: 'o', name: 'n' } as unknown as RepoRow;

const HEALTHY: BlastResult = {
  changedSymbols: [{ name: 'A', file: 'lib.ts', kind: 'function' }],
  callers: [{ file: 'r.ts', symbol: 'route', viaSymbol: 'A', line: 4, rank: 2 }],
  impactedEndpoints: ['GET /r'],
  factsByFile: { 'r.ts': { endpoints: ['GET /r'], crons: [] } },
  degraded: false,
};

function setup(
  result: BlastResult = HEALTHY,
  files: { diff?: string[]; github?: () => Promise<string[]>; pathPrs?: () => Promise<PathPullRequests[]> } = {},
) {
  const getBlastRadius = vi.fn(async () => result);
  const githubFiles = vi.fn(files.github ?? (async () => ['gh.ts']));
  const githubPathPrs = vi.fn(files.pathPrs ?? (async () => []));
  const deps: BlastDeps = {
    reviews: {
      getPull: async (ws, id) => (ws === WS && id === PULL.id ? PULL : undefined),
      getRepo: async (id) => (id === REPO.id ? REPO : undefined),
    },
    diffFiles: async () => files.diff ?? ['lib.ts', 'other.ts'],
    githubFiles,
    githubPathPrs,
    repoIntel: { getBlastRadius },
  };
  const log = { info: vi.fn(), warn: vi.fn() };
  return { service: new BlastService(deps), getBlastRadius, githubFiles, githubPathPrs, log };
}

describe('BlastService.forPull', () => {
  it('never calls GitHub for prior PRs', async () => {
    const { service, githubPathPrs } = setup();
    await service.forPull(WS, PULL.id);
    expect(githubPathPrs).not.toHaveBeenCalled();
  });

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

describe('BlastService.history', () => {
  it('slices to MAX_FILES, uses pull.base, excludes the current PR, logs', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `f${i}.ts`);
    const { service, githubPathPrs, log } = setup(HEALTHY, {
      diff: many,
      pathPrs: async () => [
        { path: 'f0.ts', prs: [{ number: 7, title: 'me', merged_at: '2026-01-01', author: 'a' },
                               { number: 3, title: 'old', merged_at: '2026-01-01', author: 'a' }] },
      ],
    });
    const res = await service.history(WS, PULL.id, log);
    expect(githubPathPrs).toHaveBeenCalledWith(REPO, 'main', [...many].sort().slice(0, PRIOR_PRS_MAX_FILES));
    expect(res.history.map((h) => h.pr_number)).toEqual([3]);
    expect(log.info).toHaveBeenCalledWith('blast: prior PRs from GitHub', { files: PRIOR_PRS_MAX_FILES, prs: 1 });
  });

  it('sends the same capped paths whatever order the changed files arrive in', async () => {
    const files = Array.from({ length: 30 }, (_, i) => `src/m${String(i).padStart(2, '0')}.ts`);
    const a = setup(HEALTHY, { diff: [...files].reverse(), pathPrs: async () => [] });
    const b = setup(HEALTHY, { diff: [...files, files[0]!], pathPrs: async () => [] });
    await a.service.history(WS, PULL.id);
    await b.service.history(WS, PULL.id);
    const expected = files.slice(0, PRIOR_PRS_MAX_FILES);
    expect(a.githubPathPrs).toHaveBeenCalledWith(REPO, 'main', expected);
    expect(b.githubPathPrs).toHaveBeenCalledWith(REPO, 'main', expected);
  });

  it('zero changed files → empty history, no GitHub call', async () => {
    const { service, githubPathPrs } = setup(HEALTHY, { diff: [], github: async () => [] });
    expect(await service.history(WS, PULL.id)).toEqual({ history: [] });
    expect(githubPathPrs).not.toHaveBeenCalled();
  });

  it('GitHub failure → warn + ExternalServiceError', async () => {
    const boom = new Error('401');
    const { service, log } = setup(HEALTHY, { pathPrs: async () => { throw boom; } });
    await expect(service.history(WS, PULL.id, log)).rejects.toBeInstanceOf(ExternalServiceError);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('prior PRs unavailable'), { err: boom });
  });

  it('keeps the adapter cause (e.g. a missing base branch) in the 502 message', async () => {
    const missing = new ExternalServiceError("GitHub: branch 'main' not found in acme/app");
    const { service } = setup(HEALTHY, { pathPrs: async () => { throw missing; } });
    await expect(service.history(WS, PULL.id)).rejects.toThrow("branch 'main' not found");
  });

  it('unknown PR → NotFoundError', async () => {
    const { service } = setup();
    await expect(service.history(WS, 'nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});
