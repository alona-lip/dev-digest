import { describe, expect, it, vi } from 'vitest';
import type { PrBlastRadius } from '@devdigest/shared';
import { getBlast } from '../src/core/blast.js';
import { fakeClient, pull, repo } from './fixtures.js';

const api: PrBlastRadius = {
  pr_id: 'pull-3',
  changed_symbols: [{ name: 'getContext', file: 'server/src/modules/_shared/context.ts', kind: 'function' }],
  downstream: [
    {
      symbol: 'getContext',
      callers: [{ name: 'settingsRoutes', file: 'server/src/modules/settings/routes.ts', line: 31 }],
      endpoints_affected: ['GET /settings'],
      crons_affected: [],
    },
  ],
  summary: '1 changed symbols · 1 callers · 1 endpoints · 0 crons',
  degraded: true,
  reason: 'index_partial',
};

function client(getBlastRadius = vi.fn().mockResolvedValue(api)) {
  return {
    getBlastRadius,
    c: fakeClient({
      listRepos: async () => [repo('octocat', 'hello')],
      listPulls: async () => [pull(3), pull(4)],
      getBlastRadius,
    }),
  };
}

describe('getBlast', () => {
  it('unknown PR → miss with known PRs, API never called', async () => {
    const { c, getBlastRadius } = client();
    const r = await getBlast(c, 'octocat/hello', 99);
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error).toContain('Known PRs: #');
    expect(getBlastRadius).not.toHaveBeenCalled();
  });

  it('known PR → one call with pullId, concise shaping, pass-through flags', async () => {
    const { c, getBlastRadius } = client();
    const r = await getBlast(c, 'octocat/hello', 3);
    expect(getBlastRadius).toHaveBeenCalledOnce();
    expect(getBlastRadius).toHaveBeenCalledWith('pull-3');
    expect(r).toMatchObject({
      repo: 'octocat/hello',
      pr: 3,
      degraded: true,
      reason: 'index_partial',
      summary: api.summary,
    });
    const ok = r as Exclude<typeof r, { error: string }>;
    expect(ok.changed_symbols[0]).toBe('getContext@server/src/modules/_shared/context.ts');
    expect(ok.downstream).toEqual(api.downstream);
  });
});
