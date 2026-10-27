import { describe, it, expect, vi } from 'vitest';
import { parseUnifiedDiff, type Intent, type UnifiedDiff } from '@devdigest/shared';
import { MockGitHubClient, MockLLMProvider, MockUrlFetcher } from '../src/adapters/mocks.js';
import { IntentService, type IntentDeps } from '../src/modules/intent/service.js';
import { defaultFeatureModel } from '../src/modules/settings/index.js';
import { NotFoundError } from '../src/platform/errors.js';
import type { PullRow, RepoRow } from '../src/db/rows.js';

const WS = 'ws-1';
const PULL = {
  id: 'pr-1',
  repoId: 'repo-1',
  number: 42,
  title: 'Add rate limiting',
  body: 'Implements docs/plans/limits.md. Closes #12. Spec: https://docs.example.com/limits',
  headSha: 'abc',
  base: 'main',
} as unknown as PullRow;
const REPO = { id: 'repo-1', owner: 'acme', name: 'api' } as unknown as RepoRow;
const DIFF: UnifiedDiff = parseUnifiedDiff(
  [
    'diff --git a/src/limits.ts b/src/limits.ts',
    '--- a/src/limits.ts',
    '+++ b/src/limits.ts',
    '@@ -1,1 +1,2 @@',
    ' a',
    `+${'BODY_LINE '.repeat(200)}`,
  ].join('\n'),
);
const FIXTURE: Intent = { intent: 'Add rate limiting to the API', in_scope: ['src/limits.ts'], out_of_scope: ['auth'] };

function setup(over: Partial<IntentDeps> & { stored?: Intent } = {}) {
  const llm = new MockLLMProvider('openai', { structuredBySchema: { Intent: FIXTURE } });
  const store = new Map<string, Intent>(over.stored ? [[PULL.id, over.stored]] : []);
  const loadDiff = vi.fn(async () => DIFF);
  const readRepoFile = vi.fn(async (_repoId: string, path: string) => (path === 'docs/plans/limits.md' ? 'PLAN: limit /api' : null));
  const deps: IntentDeps = {
    reviews: {
      getPull: async (ws, id) => (ws === WS && id === PULL.id ? PULL : undefined),
      getRepo: async (id) => (id === REPO.id ? REPO : undefined),
      getIntent: async (id) => store.get(id),
      upsertIntent: async (id, intent) => void store.set(id, intent),
    },
    loadDiff,
    repoIntel: { readRepoFile },
    github: async () => new MockGitHubClient(),
    urlFetcher: new MockUrlFetcher({
      'https://docs.example.com/limits': { body: '<h1>Limits spec</h1>', contentType: 'text/html' },
    }),
    model: async () => ({ provider: 'openai', model: 'cheap-model' }),
    llm: async () => llm,
    ...over,
  };
  const log = { info: vi.fn() };
  return { service: new IntentService(deps), llm, store, loadDiff, readRepoFile, log };
}

const userMessage = (llm: MockLLMProvider) =>
  (llm.calls.at(-1)!.req as { messages: { content: string }[] }).messages[1]!.content;

describe('IntentService.getOrCompute', () => {
  it('returns the stored intent without calling the LLM', async () => {
    const { service, llm, loadDiff } = setup({ stored: FIXTURE });
    expect(await service.getOrCompute(WS, PULL.id)).toEqual({ ...FIXTURE, pr_id: PULL.id });
    expect(llm.calls).toHaveLength(0);
    expect(loadDiff).not.toHaveBeenCalled();
  });

  it('computes, stores and returns when nothing is stored', async () => {
    const { service, llm, store } = setup();
    const out = await service.getOrCompute(WS, PULL.id);
    expect(out).toEqual({ ...FIXTURE, pr_id: PULL.id });
    expect(store.get(PULL.id)).toEqual(FIXTURE);
    const req = llm.calls[0]!.req as { model: string; schemaName: string; temperature: number };
    expect(req).toMatchObject({ model: 'cheap-model', schemaName: 'Intent', temperature: 0.1 });
  });

  it('throws NotFoundError for an unknown PR or a PR of another workspace', async () => {
    const { service } = setup();
    await expect(service.getOrCompute(WS, 'nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.getOrCompute('other-ws', PULL.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('IntentService.recompute', () => {
  it('always calls the LLM and overwrites the stored intent', async () => {
    const stale: Intent = { intent: 'old', in_scope: [], out_of_scope: [] };
    const { service, llm, store } = setup({ stored: stale });
    await service.recompute(WS, PULL.id);
    expect(llm.calls).toHaveLength(1);
    expect(store.get(PULL.id)).toEqual(FIXTURE);
  });
});

describe('classifier input', () => {
  it('folds in the repo plan, the linked issue and the external page — all as untrusted specs', async () => {
    const { service, llm, readRepoFile } = setup();
    await service.recompute(WS, PULL.id);
    const msg = userMessage(llm);
    expect(readRepoFile).toHaveBeenCalledWith('repo-1', 'docs/plans/limits.md');
    expect(msg).toContain('<untrusted source="spec:docs/plans/limits.md">\nPLAN: limit /api');
    expect(msg).toContain('<untrusted source="spec:#12">\n#12 Issue #12');
    expect(msg).toContain('<untrusted source="spec:https://docs.example.com/limits">\nLimits spec');
  });

  it('sends hunk headers, never the change bodies', async () => {
    const { service, llm } = setup();
    await service.recompute(WS, PULL.id);
    const msg = userMessage(llm);
    expect(msg).toContain('@@ -1,1 +1,2 @@');
    expect(msg).not.toContain('BODY_LINE');
  });

  it('logs the estimated token savings', async () => {
    const { service, log } = setup();
    await service.recompute(WS, PULL.id, log);
    const call = log.info.mock.calls.find(([msg]) => String(msg).includes('saved ~'));
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ savedTokens: expect.any(Number), fullDiffTokens: expect.any(Number) });
    expect((call![1] as { savedTokens: number }).savedTokens).toBeGreaterThan(0);
  });

  it('still classifies a PR with no body, issue or reference (title + files only)', async () => {
    const bare = { ...PULL, body: null } as PullRow;
    const { service, llm } = setup({
      reviews: {
        getPull: async () => bare,
        getRepo: async () => REPO,
        getIntent: async () => undefined,
        upsertIntent: async () => undefined,
      },
    });
    const out = await service.recompute(WS, PULL.id);
    expect(out.intent).toBe(FIXTURE.intent);
    const msg = userMessage(llm);
    expect(msg).toContain('Add rate limiting');
    expect(msg).toContain('src/limits.ts');
  });

  it('never stores a blank intent — falls back to the PR title', async () => {
    const llm = new MockLLMProvider('openai', { structuredBySchema: { Intent: { intent: ' ', in_scope: [], out_of_scope: [] } } });
    const { service, store } = setup({ llm: async () => llm });
    await service.recompute(WS, PULL.id);
    expect(store.get(PULL.id)!.intent).toBe('Add rate limiting');
  });
});

describe('reference resolution is best-effort', () => {
  it('works offline: no GitHub token and external fetch disabled', async () => {
    const { service, llm, log } = setup({ github: async () => null, urlFetcher: null });
    await service.recompute(WS, PULL.id, log);
    const msg = userMessage(llm);
    expect(msg).toContain('spec:docs/plans/limits.md');
    expect(msg).not.toContain('spec:#12');
    expect(msg).not.toContain('spec:https://');
    const skipped = log.info.mock.calls.map(([m]) => String(m)).filter((m) => m.includes('skipped'));
    expect(skipped).toEqual([
      'intent: reference #12 skipped — no GitHub token',
      'intent: reference https://docs.example.com/limits skipped — external fetch disabled or not a text page',
    ]);
  });

  it('skips a failing fetch and keeps the others', async () => {
    const { service, llm, log } = setup({ urlFetcher: new MockUrlFetcher({}) });
    await service.recompute(WS, PULL.id, log);
    expect(userMessage(llm)).toContain('spec:#12');
    expect(log.info.mock.calls.some(([m]) => String(m).includes('https://docs.example.com/limits skipped — The URL returned HTTP 404'))).toBe(
      true,
    );
  });

  it('skips non-text pages', async () => {
    const { service, llm } = setup({
      urlFetcher: new MockUrlFetcher({ 'https://docs.example.com/limits': { body: 'PK', contentType: 'application/zip' } }),
    });
    await service.recompute(WS, PULL.id);
    expect(userMessage(llm)).not.toContain('spec:https://');
  });
});

describe('IntentService.forRun', () => {
  it('reuses the stored intent without loading the diff or calling the LLM', async () => {
    const { service, llm, loadDiff } = setup({ stored: FIXTURE });
    const out = await service.forRun(WS, PULL, REPO, DIFF);
    expect(out).toEqual({
      intent: FIXTURE,
      source: 'stored',
      block: 'Intent: Add rate limiting to the API\nIn scope:\n- src/limits.ts\nOut of scope:\n- auth',
    });
    expect(llm.calls).toHaveLength(0);
    expect(loadDiff).not.toHaveBeenCalled();
  });

  it('computes from the run’s diff without reloading it', async () => {
    const { service, llm, loadDiff, store } = setup();
    const out = await service.forRun(WS, PULL, REPO, DIFF);
    expect(out.source).toBe('computed');
    expect(llm.calls).toHaveLength(1);
    expect(loadDiff).not.toHaveBeenCalled();
    expect(store.get(PULL.id)).toEqual(FIXTURE);
  });
});

describe('one derivation per PR at a time', () => {
  it('concurrent callers (two tabs, Overview + a review run) share one model call', async () => {
    const { service, llm, store } = setup();
    const [a, b, c] = await Promise.all([
      service.getOrCompute(WS, PULL.id),
      service.recompute(WS, PULL.id),
      service.forRun(WS, PULL, REPO, DIFF),
    ]);
    expect(llm.calls).toHaveLength(1);
    expect(a.intent).toBe(FIXTURE.intent);
    expect(b.intent).toBe(FIXTURE.intent);
    expect(c.intent).toEqual(FIXTURE);
    expect(store.get(PULL.id)).toEqual(FIXTURE);
  });

  it('does not cache a failure: the next call derives again', async () => {
    let fail = true;
    const llm = new MockLLMProvider('openai', { structuredBySchema: { Intent: FIXTURE } });
    const flaky = {
      ...llm,
      completeStructured: async (req: Parameters<MockLLMProvider['completeStructured']>[0]) => {
        if (fail) throw new Error('provider 503');
        return llm.completeStructured(req);
      },
    } as unknown as MockLLMProvider;
    const { service, store } = setup({ llm: async () => flaky });
    await expect(service.getOrCompute(WS, PULL.id)).rejects.toThrow('provider 503');
    fail = false;
    expect((await service.getOrCompute(WS, PULL.id)).intent).toBe(FIXTURE.intent);
    expect(store.get(PULL.id)).toEqual(FIXTURE);
  });

  it('a later call after the first settles computes afresh (recompute is not stuck on an old result)', async () => {
    const { service, llm } = setup();
    await service.recompute(WS, PULL.id);
    await service.recompute(WS, PULL.id);
    expect(llm.calls).toHaveLength(2);
  });
});

describe('review_intent feature model', () => {
  it('defaults to the cheap OpenRouter flash model', () => {
    expect(defaultFeatureModel('review_intent')).toEqual({ provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' });
  });
});
