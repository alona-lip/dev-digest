import { describe, it, expect, vi } from 'vitest';
import {
  BriefModelOutput,
  parseUnifiedDiff,
  type BriefRecord,
  type Intent,
  type LLMProvider,
  type PrBlastRadius,
  type PrFile,
  type StructuredRequest,
  type StructuredResult,
  type UnifiedDiff,
} from '@devdigest/shared';
import { parseWithRepair } from '@devdigest/reviewer-core';
import { MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { BriefService, type BriefDeps } from '../src/modules/brief/service.js';
import { AppError, ExternalServiceError } from '../src/platform/errors.js';
import type { PullRow, RepoRow } from '../src/db/rows.js';

const WS = 'ws-1';
const PULL = {
  id: 'pr-1',
  repoId: 'repo-1',
  number: 42,
  title: 'Add rate limiting',
  body: 'Adds limits.',
  headSha: 'sha-head',
  base: 'main',
} as unknown as PullRow;
const REPO = { id: 'repo-1', owner: 'acme', name: 'api' } as unknown as RepoRow;

const DIFF: UnifiedDiff = parseUnifiedDiff(
  [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -10,3 +10,11 @@ fnCtx',
    ' ctx',
    '+added',
    ' tail',
  ].join('\n'),
);

const INTENT: Intent = { intent: 'INTENT_FACT', in_scope: ['a'], out_of_scope: [] };

const BLAST: PrBlastRadius = {
  pr_id: PULL.id,
  degraded: false,
  reason: null,
  summary: 'BLAST_FACT',
  changed_symbols: [],
  downstream: [{ symbol: 's', callers: [{ name: 'h', file: 'src/caller.ts', line: 7 }], endpoints_affected: [], crons_affected: [] }],
};

const MODEL_OUTPUT = {
  summary: 'The PR adds rate limiting.',
  risks: [
    { kind: 'security', title: 'Bypass', explanation: 'x', severity: 'high', file_refs: ['src/a.ts:12-15'] },
    { kind: 'other', title: 'Invented', explanation: 'x', severity: 'low', file_refs: ['src/invented.ts'] },
  ],
  review_focus: [
    { file: 'src/a.ts', line: 12, reason: 'entry point' },
    { file: 'src/invented.ts', line: 1, reason: 'ghost' },
  ],
};

type Over = Partial<BriefDeps> & { stored?: unknown; llmImpl?: LLMProvider; fixture?: unknown };

function setup(over: Over = {}) {
  const llm = new MockLLMProvider('openai', { structuredBySchema: { BriefModelOutput: over.fixture ?? MODEL_OUTPUT } });
  const store = new Map<string, unknown>(over.stored === undefined ? [] : [[PULL.id, over.stored]]);
  const upsert = vi.fn(async (id: string, json: unknown) => void store.set(id, json));
  const getIntent = vi.fn(async (_id: string): Promise<Intent | undefined> => INTENT);
  let tick = 0;
  const deps: BriefDeps = {
    reviews: {
      getPull: async (ws, id) => (ws === WS && id === PULL.id ? PULL : undefined),
      getRepo: async (id) => (id === REPO.id ? REPO : undefined),
      getIntent,
      getPrFiles: async () => [],
    },
    briefs: { get: async (id) => store.get(id), upsert },
    loadDiff: async () => DIFF,
    githubFiles: async () => [],
    github: async () => new MockGitHubClient(),
    blast: async () => BLAST,
    docs: async () => ({ docs: [], attached: 0, notCloned: false, unreadable: [] }),
    model: async () => ({ provider: 'openai', model: 'brief-model' }),
    llm: async () => over.llmImpl ?? llm,
    system: async () => 'SYSTEM',
    count: (t) => Math.ceil(t.length / 4),
    now: () => new Date(Date.UTC(2026, 9, 29) + tick++ * 10),
    ...over,
  };
  // `over` may carry test-only keys; strip nothing, the service ignores extras.
  const log = { info: vi.fn(), warn: vi.fn() };
  return { service: new BriefService(deps), llm, store, upsert, getIntent, log, deps };
}

const userMessage = (llm: MockLLMProvider) =>
  (llm.calls.at(-1)!.req as { messages: { content: string }[] }).messages.map((m) => m.content).join('\n');
const structuredCalls = (llm: MockLLMProvider) => llm.calls.filter((c) => c.method === 'completeStructured');
const stored = (s: Map<string, unknown>) => s.get(PULL.id) as BriefRecord;
const throwingLlm = (msg = 'provider down'): LLMProvider => ({
  id: 'openai',
  listModels: async () => [],
  complete: async () => {
    throw new Error(msg);
  },
  completeStructured: async () => {
    throw new Error(msg);
  },
  embed: async () => [],
});

describe('BriefService.generate: one call and its output', () => {
  it('AC-8: exactly one completeStructured call with the brief schema name; no other LLM method; only getIntent for intent', async () => {
    const { service, llm, getIntent } = setup();
    await service.generate(WS, PULL.id);
    // contract: one structured call, schema BriefModelOutput
    expect(llm.calls.map((c) => c.method)).toEqual(['completeStructured']);
    expect(structuredCalls(llm)).toHaveLength(1);
    expect((structuredCalls(llm)[0]!.req as { schemaName: string }).schemaName).toBe('BriefModelOutput');
    // contract: intent is read from storage only (BriefDeps has no compute path)
    expect(getIntent).toHaveBeenCalledTimes(1);
  });

  it('AC-23/AC-8: success stores the post-validated brief with the head sha captured at start and returns ready/not stale', async () => {
    const { service, store } = setup();
    const res = await service.generate(WS, PULL.id);
    expect(res).toMatchObject({ status: 'ready', stale: false, current_head_sha: 'sha-head' });
    const rec = stored(store);
    expect(rec.head_sha).toBe('sha-head');
    // contract: invented risk and focus dropped, real ones kept
    expect(rec.risks.map((r) => r.title)).toEqual(['Bypass']);
    expect(rec.review_focus).toHaveLength(1);
    expect(rec.dropped).toEqual({ risks: 1, review_focus: 1 });
    if (res.status === 'ready') expect(res.brief).toEqual(rec);
  });

  it('AC-2: a malformed model output is an error and nothing is stored', async () => {
    // MockLLMProvider validates its fixture against the requested schema, so a
    // fixture without `summary` makes completeStructured fail like invalid output.
    const { service, upsert, store } = setup({ fixture: { risks: [], review_focus: [] } });
    await expect(service.generate(WS, PULL.id)).rejects.toBeInstanceOf(ExternalServiceError);
    expect(upsert).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('AC-24: a throwing model call is an error (502), nothing is written, the previous brief is untouched', async () => {
    const previous = { sentinel: 'previous brief json' };
    const { service, upsert, store, log } = setup({ llmImpl: throwingLlm(), stored: previous });
    const err = await service.generate(WS, PULL.id, log).catch((e) => e);
    expect(err).toBeInstanceOf(ExternalServiceError);
    expect((err as AppError).statusCode).toBe(502);
    expect(upsert).not.toHaveBeenCalled();
    expect(store.get(PULL.id)).toBe(previous);
  });

  it('AC-37: when validation drops every risk and focus item, the brief is still stored with its summary and empty lists', async () => {
    const fixture = {
      summary: 'Only a summary survives.',
      risks: [{ kind: 'other', title: 'x', explanation: 'x', severity: 'low', file_refs: ['/etc/passwd'] }],
      review_focus: [{ file: '/etc/passwd', line: 1, reason: 'x' }],
    };
    const { service, store } = setup({ fixture });
    const res = await service.generate(WS, PULL.id);
    expect(res.status).toBe('ready');
    expect(stored(store)).toMatchObject({
      summary: 'Only a summary survives.',
      risks: [],
      review_focus: [],
      dropped: { risks: 1, review_focus: 1 },
    });
  });
});

describe('BriefService.generate: missing inputs', () => {
  it('AC-12: no stored intent -> brief generated without it, missing_inputs names intent/not_computed, no intent in the message', async () => {
    const { service, llm, store, getIntent } = setup();
    getIntent.mockResolvedValue(undefined);
    await service.generate(WS, PULL.id);
    expect(stored(store).missing_inputs).toContainEqual({ input: 'intent', reason: 'not_computed' });
    expect(userMessage(llm)).not.toContain('INTENT_FACT');
    expect(structuredCalls(llm)).toHaveLength(1);
  });

  it('AC-13: a degraded blast map -> brief stored, missing_inputs carries the degraded reason, blast text and caller files unused', async () => {
    const degraded: PrBlastRadius = { ...BLAST, degraded: true, reason: 'index_partial' };
    const fixture = { ...MODEL_OUTPUT, review_focus: [{ file: 'src/caller.ts', line: 7, reason: 'caller' }] };
    const { service, llm, store } = setup({ blast: async () => degraded, fixture });
    await service.generate(WS, PULL.id);
    const rec = stored(store);
    expect(rec.missing_inputs).toContainEqual({ input: 'blast', reason: 'index_partial' });
    expect(userMessage(llm)).not.toContain('BLAST_FACT');
    // contract: AC-29 — callers of a degraded map are not valid paths
    expect(rec.review_focus).toEqual([]);
  });

  it('AC-13: a blast load that throws -> brief stored, missing_inputs blast/error', async () => {
    const { service, store, log } = setup({
      blast: async () => {
        throw new Error('index exploded');
      },
    });
    await service.generate(WS, PULL.id, log);
    expect(stored(store).missing_inputs).toContainEqual({ input: 'blast', reason: 'error' });
  });

  it('AC-14: "closes #12" with GitHub answering -> the issue text is in the message and nothing is missing', async () => {
    const github = new MockGitHubClient();
    vi.spyOn(github, 'getIssue').mockResolvedValue({ number: 12, title: 'ISSUE_TITLE_FACT', body: 'ISSUE_BODY_FACT', state: 'open' });
    const { service, llm, store } = setup({ github: async () => github });
    (PULL as { body: string }).body = 'Closes #12';
    try {
      await service.generate(WS, PULL.id);
    } finally {
      (PULL as { body: string }).body = 'Adds limits.';
    }
    expect(userMessage(llm)).toContain('ISSUE_TITLE_FACT');
    expect(userMessage(llm)).toContain('ISSUE_BODY_FACT');
    expect(stored(store).missing_inputs.map((m) => m.input)).not.toContain('linked_issue');
  });

  it('AC-14: GitHub failing -> linked_issue/fetch_failed, brief still stored; null client -> no_github_token', async () => {
    const failing = new MockGitHubClient();
    vi.spyOn(failing, 'getIssue').mockRejectedValue(new Error('500'));
    vi.spyOn(failing, 'getPullRequest').mockRejectedValue(new Error('500'));
    const original = PULL.body;
    (PULL as { body: string | null }).body = 'Closes #12';
    try {
      const a = setup({ github: async () => failing });
      await a.service.generate(WS, PULL.id);
      expect(stored(a.store).missing_inputs).toContainEqual({ input: 'linked_issue', reason: 'fetch_failed' });

      const b = setup({ github: async () => null });
      await b.service.generate(WS, PULL.id);
      expect(stored(b.store).missing_inputs).toContainEqual({ input: 'linked_issue', reason: 'no_github_token' });
    } finally {
      (PULL as { body: string | null }).body = original;
    }
  });

  it('AC-14: a body with no issue references reports nothing missing and never asks for GitHub', async () => {
    const github = vi.fn(async () => null);
    const { service, store } = setup({ github });
    await service.generate(WS, PULL.id);
    expect(github).not.toHaveBeenCalled();
    expect(stored(store).missing_inputs.map((m) => m.input)).not.toContain('linked_issue');
  });

  it('AC-16: documents attached but none readable -> specs missing (not_cloned / unreadable)', async () => {
    const a = setup({ docs: async () => ({ docs: [], attached: 2, notCloned: false, unreadable: [{ path: 'a', reason: 'missing' }] }) });
    await a.service.generate(WS, PULL.id);
    expect(stored(a.store).missing_inputs).toContainEqual({ input: 'specs', reason: 'unreadable' });

    const b = setup({ docs: async () => ({ docs: [], attached: 2, notCloned: true, unreadable: [] }) });
    await b.service.generate(WS, PULL.id);
    expect(stored(b.store).missing_inputs).toContainEqual({ input: 'specs', reason: 'not_cloned' });
  });

  it('AC-16: one readable document among unreadable ones -> only it is in the message and specs is not reported missing', async () => {
    const { service, llm, store } = setup({
      docs: async () => ({
        docs: [{ path: 'specs/ok.md', text: 'READABLE_DOC_FACT', tokens: 5 }],
        attached: 2,
        notCloned: false,
        unreadable: [{ path: 'specs/gone.md', reason: 'missing' }],
      }),
    });
    await service.generate(WS, PULL.id);
    expect(userMessage(llm)).toContain('READABLE_DOC_FACT');
    expect(userMessage(llm)).not.toContain('specs/gone.md');
    expect(stored(store).missing_inputs.map((m) => m.input)).not.toContain('specs');
  });
});

describe('BriefService.generate: budget and changed files', () => {
  it('AC-19: trimming logs which input was trimmed and by how many tokens, and records trimmed_inputs', async () => {
    const docs = Array.from({ length: 6 }, (_, i) => ({ path: `docs/d${i}.md`, text: `w${i} `.repeat(8000), tokens: 8000 }));
    const { service, store, log, llm } = setup({ docs: async () => ({ docs, attached: 6, notCloned: false, unreadable: [] }) });
    await service.generate(WS, PULL.id, log);
    expect(stored(store).trimmed_inputs).toEqual(['specs']);
    const line = log.info.mock.calls.find(([m]) => /specs/.test(String(m)) && /trimmed/.test(String(m)));
    expect(line).toBeDefined();
    expect((line![1] as { input: string; tokens: number }).input).toBe('specs');
    expect((line![1] as { tokens: number }).tokens).toBeGreaterThan(0);
    expect(structuredCalls(llm)).toHaveLength(1);
  });

  it('AC-17: the messages handed to the model stay within the 8,000-token budget', async () => {
    const docs = Array.from({ length: 6 }, (_, i) => ({ path: `docs/d${i}.md`, text: `w${i} `.repeat(8000), tokens: 8000 }));
    const { service, llm, deps } = setup({ docs: async () => ({ docs, attached: 6, notCloned: false, unreadable: [] }) });
    await service.generate(WS, PULL.id);
    const msgs = (structuredCalls(llm)[0]!.req as { messages: { content: string }[] }).messages;
    expect(msgs.reduce((n, m) => n + deps.count(m.content), 0)).toBeLessThanOrEqual(8000);
  });

  it('AC-20: a 2,000-file PR -> 422 brief_input_too_large, zero model calls, previous brief kept', async () => {
    const hunks = Array.from({ length: 2000 }, (_, i) => `diff --git a/src/f${i}.ts b/src/f${i}.ts\n--- a/src/f${i}.ts\n+++ b/src/f${i}.ts\n@@ -1,2 +1,60 @@\n+x`);
    const previous = { sentinel: 'keep me' };
    const { service, llm, upsert, store } = setup({ loadDiff: async () => parseUnifiedDiff(hunks.join('\n')), stored: previous });
    const err = await service.generate(WS, PULL.id).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'brief_input_too_large', statusCode: 422 });
    expect(llm.calls).toHaveLength(0);
    expect(upsert).not.toHaveBeenCalled();
    expect(store.get(PULL.id)).toBe(previous);
  });

  it('AC-22: no local diff and the GitHub file list failing -> 502, a warn log, zero model calls, nothing stored', async () => {
    const { service, llm, upsert, log } = setup({
      loadDiff: async () => ({ raw: '', files: [] }),
      githubFiles: async (): Promise<PrFile[]> => {
        throw new Error('github down');
      },
    });
    const err = await service.generate(WS, PULL.id, log).catch((e) => e);
    expect(err).toBeInstanceOf(ExternalServiceError);
    expect((err as AppError).statusCode).toBe(502);
    expect(log.warn).toHaveBeenCalled();
    expect(llm.calls).toHaveLength(0);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('BriefService.generate: concurrency and logging', () => {
  it('AC-25: two concurrent generate calls share one model call and return equal results', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inner = new MockLLMProvider('openai', { structuredBySchema: { BriefModelOutput: MODEL_OUTPUT } });
    const gated: LLMProvider = {
      id: 'openai',
      listModels: () => inner.listModels(),
      complete: (r) => inner.complete(r),
      embed: (t) => inner.embed(t),
      completeStructured: async (r) => {
        await gate;
        return inner.completeStructured(r);
      },
    };
    const { service } = setup({ llmImpl: gated });
    const p1 = service.generate(WS, PULL.id);
    const p2 = service.generate(WS, PULL.id);
    await new Promise((r) => setImmediate(r));
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(structuredCalls(inner)).toHaveLength(1);
    expect(r1).toEqual(r2);

    // contract: the in-flight entry is cleared afterwards — a later request starts a new generation
    await service.generate(WS, PULL.id);
    expect(structuredCalls(inner)).toHaveLength(2);
  });

  it('AC-28: a successful generation writes one structured log line with all required fields', async () => {
    const { service, log } = setup();
    await service.generate(WS, PULL.id, log);
    const lines = log.info.mock.calls.filter(([m]) => m === 'brief: generated');
    expect(lines).toHaveLength(1);
    expect(lines[0]![1]).toMatchObject({
      prId: PULL.id,
      model: 'openai/brief-model',
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      costUsd: expect.any(Number),
      missingInputs: expect.any(Array),
      trimmedInputs: expect.any(Array),
      droppedRisks: 1,
      droppedFocus: 1,
      durationMs: expect.any(Number),
    });
  });

  it('AC-28: a model failure also writes the log line with the same field names', async () => {
    const { service, log } = setup({ llmImpl: throwingLlm() });
    await service.generate(WS, PULL.id, log).catch(() => undefined);
    const lines = log.info.mock.calls.filter(([m]) => m === 'brief: generated');
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0]![1] as object)).toEqual(
      expect.arrayContaining([
        'prId', 'model', 'inputTokens', 'outputTokens', 'costUsd', 'missingInputs', 'trimmedInputs', 'droppedRisks', 'droppedFocus', 'durationMs',
      ]),
    );
  });

  it('AC-28: the log line never carries message text, keys or tokens', async () => {
    const { service, log } = setup();
    await service.generate(WS, PULL.id, log);
    const dump = JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls]);
    expect(dump).not.toContain('SYSTEM');
    expect(dump).not.toContain('INTENT_FACT');
  });
});

// ---------- AC-63: re-prompt inside one call ----------

/**
 * Provider that behaves like the real adapters: ONE completeStructured invocation
 * loops parseWithRepair over successive raw replies (re-prompting on invalid ones).
 */
function repairingProvider(replies: string[], maxRetries = 3) {
  const invocations: unknown[] = [];
  const results: StructuredResult<unknown>[] = [];
  const provider: LLMProvider = {
    id: 'openai',
    listModels: async () => [],
    complete: async () => {
      throw new Error('not used');
    },
    embed: async () => [],
    async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      invocations.push(req);
      let last = '';
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        last = replies[Math.min(attempt - 1, replies.length - 1)]!;
        const parsed = parseWithRepair(req.schema, last);
        if (parsed.ok) {
          const res = { data: parsed.data, model: req.model, tokensIn: 10, tokensOut: 5, costUsd: 0.01, raw: last, attempts: attempt };
          results.push(res as StructuredResult<unknown>);
          return res;
        }
      }
      throw new ExternalServiceError('structured output failed schema validation', { raw: last });
    },
  };
  return { provider, invocations, results };
}

describe('BriefService.generate: invalid kind (AC-63)', () => {
  const bad = JSON.stringify({
    ...MODEL_OUTPUT,
    risks: [{ kind: 'auth', title: 't', explanation: 'e', severity: 'high', file_refs: ['src/a.ts'] }],
  });
  const good = JSON.stringify(MODEL_OUTPUT);

  it('AC-63: kind "auth" first, then a valid reply -> one outer invocation, attempts 2, brief stored', async () => {
    expect(BriefModelOutput.safeParse(JSON.parse(bad)).success).toBe(false);
    const { provider, invocations, results } = repairingProvider([bad, good]);
    const { service, store, upsert } = setup({ llmImpl: provider });
    const res = await service.generate(WS, PULL.id);
    expect(invocations).toHaveLength(1);
    expect(results[0]!.attempts).toBe(2);
    expect(res.status).toBe('ready');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(stored(store).summary).toBe(MODEL_OUTPUT.summary);
  });

  it('AC-63: always invalid -> the generation errors, nothing is stored, the previous brief stays', async () => {
    const previous = { sentinel: 'previous' };
    const { provider, invocations } = repairingProvider([bad]);
    const { service, store, upsert } = setup({ llmImpl: provider, stored: previous });
    await expect(service.generate(WS, PULL.id)).rejects.toBeInstanceOf(ExternalServiceError);
    expect(invocations).toHaveLength(1);
    expect(upsert).not.toHaveBeenCalled();
    expect(store.get(PULL.id)).toBe(previous);
  });
});
