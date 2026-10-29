import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { rm, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { cleanupClones, insertPr, insertRepo, makeClone } from './helpers/project-context-fixtures.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { FsProjectDocsReader } from '../src/adapters/project-docs/fs-reader.js';
import type { Review, Tokenizer } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[project-context-run] Docker not available — skipping integration tests.');

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW: Review = {
  verdict: 'approve',
  summary: 'x',
  score: 90,
  findings: [],
};

type Json = Record<string, any>;

/** The agent LLM fails on the review call (the Intent call still succeeds). */
class FailingReviewLLM extends MockLLMProvider {
  override async completeStructured<T>(req: Parameters<MockLLMProvider['completeStructured']>[0]) {
    if (req.schemaName === 'Intent') return super.completeStructured(req) as never as Promise<never>;
    this.calls.push({ method: 'completeStructured', req });
    throw new Error('model exploded');
  }
}

/** Real fs reader that fires a hook after every read (used to cancel mid-assembly). */
class HookedReader extends FsProjectDocsReader {
  onRead?: () => Promise<void>;
  override async read(...args: Parameters<FsProjectDocsReader['read']>) {
    const r = await super.read(...args);
    await this.onRead?.();
    return r;
  }
}

/** 1 char = 1 token: makes the 12k budget arithmetic exact. */
const lengthTokenizer: Tokenizer = { count: (text: string) => text.length };

d('project context in a review run (Testcontainers pg + fixture clone)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
    await cleanupClones();
  });

  let seq = 0;
  const uniq = (s: string) => `${s}-${seq++}`;
  const db = () => pg.handle.db;

  interface Harness {
    app: Awaited<ReturnType<typeof buildApp>>;
    llm: MockLLMProvider;
    intent: MockLLMProvider;
  }

  async function makeApp(
    extra: { tokenizer?: Tokenizer; projectDocs?: FsProjectDocsReader; llm?: MockLLMProvider; diff?: string } = {},
  ): Promise<Harness> {
    const llm = extra.llm ?? new MockLLMProvider('openai', { structured: REVIEW });
    const intent = new MockLLMProvider('openai', {
      structuredBySchema: { Intent: { intent: 'test PR', in_scope: [], out_of_scope: [] } },
    });
    const app = await buildApp({
      config: config(),
      db: db(),
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: extra.diff ?? DIFF }),
        github: new MockGitHubClient(),
        // every provider a run can reach is mocked (agent model + review_intent feature model)
        llm: { openai: llm, openrouter: intent },
        ...(extra.tokenizer ? { tokenizer: extra.tokenizer } : {}),
        ...(extra.projectDocs ? { projectDocs: extra.projectDocs } : {}),
      },
    });
    return { app, llm, intent };
  }

  const mkAgent = async (h: Harness) =>
    (
      await h.app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: uniq('run-agent'), provider: 'openai', model: 'gpt-4.1', system_prompt: 'AGENT PROMPT' },
      })
    ).json() as Json;
  const mkSkill = async (h: Harness) =>
    (
      await h.app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: uniq('run-skill'), description: 'Use when x.', type: 'rubric', body: 'Rule.' },
      })
    ).json() as Json;
  const attach = async (h: Harness, kind: 'agents' | 'skills', id: string, repoId: string, paths: string[]) => {
    const r = await h.app.inject({ method: 'PUT', url: `/${kind}/${id}/context`, payload: { repo_id: repoId, paths } });
    expect(r.statusCode).toBe(200);
  };
  const bind = (h: Harness, agentId: string, skillIds: string[]) =>
    h.app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/skills`,
      payload: { skills: skillIds.map((skill_id) => ({ skill_id, enabled: true })) },
    });

  /** Start a review and wait until the run AND its persisted trace exist. */
  async function review(h: Harness, agentId: string, prId: string) {
    await h.app.inject({ method: 'POST', url: `/pulls/${prId}/review`, payload: { agentId } });
    const [run] = await waitForPrRuns(db(), prId, { expected: 1 });
    let trace: Json | undefined;
    for (let i = 0; i < 200 && !trace; i++) {
      const r = await h.app.inject({ method: 'GET', url: `/runs/${run!.id}/trace` });
      if (r.statusCode === 200 && r.json()?.prompt_assembly) trace = r.json();
      else await new Promise((res) => setTimeout(res, 25));
    }
    return { run: run!, trace: trace! };
  }

  const userMsg = (h: Harness): string => {
    const call = h.llm.calls.find((c) => c.method === 'completeStructured')!;
    return (call.req as { messages: { content: string }[] }).messages[1]!.content;
  };
  const logText = (trace: Json) => trace.log.map((l: { msg: string }) => l.msg).join('\n');
  const block = (msg: string, path: string) => {
    const open = `<untrusted source="${path}">`;
    const start = msg.indexOf(open);
    return start < 0 ? undefined : msg.slice(start, msg.indexOf('</untrusted>', start));
  };

  async function setup(files: Record<string, string | Uint8Array>) {
    const clone = await makeClone(files);
    const repo = await insertRepo(db(), workspaceId, clone);
    const pr = await insertPr(db(), workspaceId, repo.id);
    return { clone, repo, pr };
  }

  // ------------------------------------------------------------------ order
  it('AC-24/AC-40: prompt blocks and specs_read go agent docs first, then each active skill in order, deduped by full path', async () => {
    const h = await makeApp();
    const { repo, pr } = await setup({
      'docs/b.md': '# b',
      'specs/a.md': '# a',
      'docs/x.md': '# docs x',
      'specs/x.md': '# specs x',
      'insights/c.md': '# c',
      'e2e/docs/specs/z.md': '# z',
    });
    const agent = await mkAgent(h);
    const [s1, s2] = [await mkSkill(h), await mkSkill(h)];
    await bind(h, agent.id, [s1.id, s2.id]);
    await attach(h, 'agents', agent.id, repo.id, ['docs/b.md', 'specs/x.md']);
    await attach(h, 'skills', s1.id, repo.id, ['insights/c.md', 'docs/b.md', 'docs/x.md']); // docs/b.md duplicate
    await attach(h, 'skills', s2.id, repo.id, ['specs/a.md', 'insights/c.md', 'e2e/docs/specs/z.md']); // c duplicate

    const { run, trace } = await review(h, agent.id, pr.id);
    expect(run.status).toBe('done');
    const expected = ['docs/b.md', 'specs/x.md', 'insights/c.md', 'docs/x.md', 'specs/a.md', 'e2e/docs/specs/z.md'];
    // contract: specs_read lists the added docs in prompt order; same-named docs in different dirs are both kept
    expect(trace.specs_read).toEqual(expected);
    const msg = userMsg(h);
    const positions = expected.map((p) => msg.indexOf(`<untrusted source="${p}">`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
    // contract: a repeated full path is added once
    expect(msg.split('<untrusted source="docs/b.md">')).toHaveLength(2);
    // contract: skill origins carry the skill name
    const byPath = Object.fromEntries(trace.prompt_assembly.spec_blocks.map((b: Json) => [b.path, b]));
    expect(byPath['docs/b.md'].origin).toEqual({ kind: 'agent' });
    expect(byPath['insights/c.md'].origin).toEqual({ kind: 'skill', skill_id: s1.id, name: s1.name });
    expect(byPath['specs/a.md'].origin).toEqual({ kind: 'skill', skill_id: s2.id, name: s2.name });
    await h.app.close();
  });

  it('AC-24: reordering the agent\'s attachments changes the order of the blocks in the prompt', async () => {
    const h = await makeApp();
    const { repo, pr } = await setup({ 'specs/a.md': '# a', 'docs/b.md': '# b' });
    const agent = await mkAgent(h);
    await attach(h, 'agents', agent.id, repo.id, ['docs/b.md', 'specs/a.md']);
    await attach(h, 'agents', agent.id, repo.id, ['specs/a.md', 'docs/b.md']); // user reorders
    const { trace } = await review(h, agent.id, pr.id);
    expect(trace.specs_read).toEqual(['specs/a.md', 'docs/b.md']);
    const msg = userMsg(h);
    expect(msg.indexOf('source="specs/a.md"')).toBeLessThan(msg.indexOf('source="docs/b.md"'));
    await h.app.close();
  });

  it('AC-40: only attachments for the PR\'s repository are used; a disabled skill contributes nothing', async () => {
    const h = await makeApp();
    const { repo, pr } = await setup({ 'specs/a.md': '# a', 'docs/b.md': '# b' });
    const other = await setup({ 'specs/a.md': '# other a' });
    const agent = await mkAgent(h);
    const off = await mkSkill(h);
    await h.app.inject({ method: 'PUT', url: `/agents/${agent.id}/skills`, payload: { skills: [{ skill_id: off.id, enabled: false }] } });
    await attach(h, 'agents', agent.id, other.repo.id, ['specs/a.md']);
    await attach(h, 'agents', agent.id, repo.id, ['docs/b.md']);
    await attach(h, 'skills', off.id, repo.id, ['specs/a.md']);
    const { trace } = await review(h, agent.id, pr.id);
    // contract: other-repo attachments and disabled skills are not part of the effective set
    expect(trace.specs_read).toEqual(['docs/b.md']);
    expect(trace.prompt_assembly.spec_blocks.map((b: Json) => b.path)).toEqual(['docs/b.md']);
    await h.app.close();
  });

  // ------------------------------------------------------------------ AC-41
  it('AC-41: the prompt holds the default-branch (clone) version of a file the PR modifies', async () => {
    const prDiff = `diff --git a/specs/a.md b/specs/a.md
--- a/specs/a.md
+++ b/specs/a.md
@@ -1,1 +1,1 @@
-DEFAULT-BRANCH-VERSION
+PR-BRANCH-VERSION
diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;
    const h = await makeApp({ diff: prDiff });
    const { repo, pr } = await setup({ 'specs/a.md': 'DEFAULT-BRANCH-VERSION' });
    const agent = await mkAgent(h);
    await attach(h, 'agents', agent.id, repo.id, ['specs/a.md']);
    const { trace } = await review(h, agent.id, pr.id);
    const b = block(userMsg(h), 'specs/a.md')!;
    // contract: spec text comes from the clone, never from the PR branch
    expect(b).toContain('DEFAULT-BRANCH-VERSION');
    expect(b).not.toContain('PR-BRANCH-VERSION');
    expect(trace.prompt_assembly.spec_blocks[0].text).toBe('DEFAULT-BRANCH-VERSION');
    await h.app.close();
  });

  // ------------------------------------------------------------------ AC-44
  it('AC-44: a missing file and a binary file are skipped (status missing, one log line each); the run is done', async () => {
    const h = await makeApp();
    const { clone, repo, pr } = await setup({
      'docs/ok.md': '# fine',
      'docs/gone.md': '# soon deleted',
      'docs/bin.md': '# soon binary',
    });
    const agent = await mkAgent(h);
    await attach(h, 'agents', agent.id, repo.id, ['docs/gone.md', 'docs/bin.md', 'docs/ok.md']);
    await rm(join(clone, 'docs/gone.md'));
    await writeFile(join(clone, 'docs/bin.md'), new Uint8Array([0xff, 0xfe, 0x00, 0xc3, 0x28]));

    const { run, trace } = await review(h, agent.id, pr.id);
    expect(run.status).toBe('done');
    const blocks = Object.fromEntries(trace.prompt_assembly.spec_blocks.map((b: Json) => [b.path, b]));
    // contract: unreadable -> missing, tokens null, no text; the readable one is still attached
    expect(blocks['docs/gone.md']).toMatchObject({ status: 'missing', tokens: null, text: null });
    expect(blocks['docs/bin.md']).toMatchObject({ status: 'missing', tokens: null, text: null });
    expect(blocks['docs/ok.md']).toMatchObject({ status: 'attached' });
    expect(trace.specs_read).toEqual(['docs/ok.md']);
    const lines = (logText(trace) as string).split('\n');
    expect(lines.filter((l) => l.includes('docs/gone.md') && l.includes('missing'))).toHaveLength(1);
    expect(lines.filter((l) => l.includes('docs/bin.md') && l.includes('missing'))).toHaveLength(1);
    expect(userMsg(h)).not.toContain('source="docs/gone.md"');
    expect(userMsg(h)).not.toContain('source="docs/bin.md"');
    await h.app.close();
  });

  // ------------------------------------------------------------------ AC-45
  it('AC-45: 7k/7k/2k docs against the 12k budget -> attached, over_budget, attached; the skipped one is logged', async () => {
    const h = await makeApp({ tokenizer: lengthTokenizer });
    const { repo, pr } = await setup({
      'docs/a.md': 'A'.repeat(7000),
      'docs/b.md': 'B'.repeat(7000),
      'docs/c.md': 'C'.repeat(2000),
    });
    const agent = await mkAgent(h);
    await attach(h, 'agents', agent.id, repo.id, ['docs/a.md', 'docs/b.md', 'docs/c.md']);
    const { run, trace } = await review(h, agent.id, pr.id);
    expect(run.status).toBe('done');
    const sb = trace.prompt_assembly.spec_blocks;
    // contract: whole-document greedy budget; later docs that still fit are added
    expect(sb.map((b: Json) => [b.path, b.status])).toEqual([
      ['docs/a.md', 'attached'],
      ['docs/b.md', 'over_budget'],
      ['docs/c.md', 'attached'],
    ]);
    expect(sb[1]).toMatchObject({ tokens: 7000, text: null });
    expect(trace.specs_read).toEqual(['docs/a.md', 'docs/c.md']);
    expect(userMsg(h)).not.toContain('B'.repeat(50));
    expect(logText(trace).split('\n').filter((l: string) => l.includes('docs/b.md') && l.includes('over_budget'))).toHaveLength(1);
    await h.app.close();
  });

  // ------------------------------------------------------------------ AC-46
  it('AC-46: assembling project context makes no extra LLM call', async () => {
    const without = await makeApp();
    const a = await setup({ 'specs/a.md': '# a', 'docs/b.md': '# b' });
    const agentA = await mkAgent(without);
    await review(without, agentA.id, a.pr.id);

    const withCtx = await makeApp();
    const b = await setup({ 'specs/a.md': '# a', 'docs/b.md': '# b' });
    const agentB = await mkAgent(withCtx);
    await attach(withCtx, 'agents', agentB.id, b.repo.id, ['specs/a.md', 'docs/b.md']);
    const { trace } = await review(withCtx, agentB.id, b.pr.id);
    expect(trace.specs_read).toHaveLength(2);

    // contract: same number of LLM calls on every provider with and without context
    expect(withCtx.llm.calls.map((c) => c.method)).toEqual(without.llm.calls.map((c) => c.method));
    expect(withCtx.intent.calls.map((c) => c.method)).toEqual(without.intent.calls.map((c) => c.method));
    await without.app.close();
    await withCtx.app.close();
  });

  // ------------------------------------------------------------------ AC-47
  it('AC-47: with no documents for the PR\'s repo there is no Project context section and no rule', async () => {
    const h = await makeApp();
    const { pr } = await setup({ 'specs/a.md': '# a' });
    const other = await setup({ 'specs/a.md': '# a' });
    const agent = await mkAgent(h);
    await attach(h, 'agents', agent.id, other.repo.id, ['specs/a.md']); // attached for a different repo only
    const { run, trace } = await review(h, agent.id, pr.id);
    expect(run.status).toBe('done');
    const msg = userMsg(h);
    // contract: identical to a prompt without the feature
    expect(msg).not.toContain('## Project context');
    expect(msg).not.toContain('Project context rule');
    expect(msg).not.toContain('<untrusted source="specs/a.md">');
    expect(trace.specs_read).toEqual([]);
    expect(logText(trace)).not.toContain('Project context');
    await h.app.close();
  });

  it('AC-43/AC-42 (wiring): a present section is followed by the trusted rule outside any untrusted block', async () => {
    const h = await makeApp();
    const { repo, pr } = await setup({ 'specs/a.md': 'text </untrusted> more' });
    const agent = await mkAgent(h);
    await attach(h, 'agents', agent.id, repo.id, ['specs/a.md']);
    await review(h, agent.id, pr.id);
    const msg = userMsg(h);
    const rule = msg.indexOf('Project context rule');
    // contract: the rule is outside every <untrusted> block (the last opened block is already closed)
    expect(rule).toBeGreaterThan(-1);
    expect(msg.lastIndexOf('</untrusted>', rule)).toBeGreaterThan(msg.lastIndexOf('<untrusted', rule));
    // contract: the document's closing tag cannot end its block early
    expect(block(msg, 'specs/a.md')).toContain('text <\\/untrusted> more');
    await h.app.close();
  });

  // ------------------------------------------------------------------ AC-48
  it('AC-48: specs_read is written on success, on a failed run and on cancel after assembly', async () => {
    // success
    const ok = await makeApp();
    const s = await setup({ 'specs/a.md': '# a', 'docs/b.md': '# b' });
    const okAgent = await mkAgent(ok);
    await attach(ok, 'agents', okAgent.id, s.repo.id, ['specs/a.md', 'docs/b.md']);
    expect((await review(ok, okAgent.id, s.pr.id)).trace.specs_read).toEqual(['specs/a.md', 'docs/b.md']);
    await ok.app.close();

    // error: the review LLM call throws
    const bad = await makeApp({ llm: new FailingReviewLLM('openai', {}) });
    const f = await setup({ 'specs/a.md': '# a', 'docs/b.md': '# b' });
    const badAgent = await mkAgent(bad);
    await attach(bad, 'agents', badAgent.id, f.repo.id, ['specs/a.md', 'docs/b.md']);
    const failed = await review(bad, badAgent.id, f.pr.id);
    expect(failed.run.status).toBe('failed');
    // contract: docs added before the failure are still reported
    expect(failed.trace.specs_read).toEqual(['specs/a.md', 'docs/b.md']);
    expect(failed.trace.prompt_assembly.spec_blocks.map((b: Json) => b.status)).toEqual(['attached', 'attached']);
    await bad.app.close();

    // cancel right after the context was assembled
    const reader = new HookedReader();
    const can = await makeApp({ projectDocs: reader });
    const c = await setup({ 'specs/a.md': '# a', 'docs/b.md': '# b' });
    const canAgent = await mkAgent(can);
    await attach(can, 'agents', canAgent.id, c.repo.id, ['specs/a.md', 'docs/b.md']);
    reader.onRead = async () => {
      const runs = await db().select().from(t.agentRuns).where(eq(t.agentRuns.prId, c.pr.id));
      for (const r of runs) can.app.container.runBus.cancel(r.id);
    };
    const cancelled = await review(can, canAgent.id, c.pr.id);
    expect(cancelled.run.status).toBe('cancelled');
    expect(cancelled.trace.specs_read).toEqual(['specs/a.md', 'docs/b.md']);
    await can.app.close();
  });

  // ------------------------------------------------------------------ AC-49
  it('AC-49: spec_blocks has one entry per effective doc with path/type/origin/status/tokens/text; prompt_assembly.specs is null', async () => {
    const h = await makeApp({ tokenizer: lengthTokenizer });
    const { clone, repo, pr } = await setup({
      'specs/a.md': 'ten chars!',
      'docs/empty.md': '',
      'docs/gone.md': '# deleted later',
      'docs/grown.md': 'small now',
      'insights/huge.md': 'H'.repeat(13000),
    });
    const agent = await mkAgent(h);
    const skill = await mkSkill(h);
    await bind(h, agent.id, [skill.id]);
    await attach(h, 'agents', agent.id, repo.id, ['specs/a.md', 'docs/empty.md', 'docs/gone.md']);
    await attach(h, 'skills', skill.id, repo.id, ['docs/grown.md', 'insights/huge.md']);
    await rm(join(clone, 'docs/gone.md'));
    await truncate(join(clone, 'docs/grown.md'), 1_153_434); // grew past 1 MB after attaching

    const { run, trace } = await review(h, agent.id, pr.id);
    expect(run.status).toBe('done');
    const pa = trace.prompt_assembly;
    // contract: new traces leave prompt_assembly.specs null; spec_blocks is the source of truth
    expect(pa.specs).toBeNull();
    const by = Object.fromEntries(pa.spec_blocks.map((b: Json) => [b.path, b]));
    expect(pa.spec_blocks).toHaveLength(5);
    expect(by['specs/a.md']).toEqual({
      path: 'specs/a.md',
      type: 'specs',
      origin: { kind: 'agent' },
      status: 'attached',
      tokens: 10,
      text: 'ten chars!',
    });
    // contract: an empty document counts 0 and is still attached
    expect(by['docs/empty.md']).toMatchObject({ status: 'attached', tokens: 0, text: '' });
    expect(by['docs/gone.md']).toMatchObject({ status: 'missing', tokens: null, text: null });
    // contract: a file now > 1 MB is over_budget with tokens null and the reason "> 1 MB" in the log
    expect(by['docs/grown.md']).toMatchObject({
      status: 'over_budget',
      tokens: null,
      text: null,
      origin: { kind: 'skill', skill_id: skill.id, name: skill.name },
    });
    expect(logText(trace).split('\n').some((l: string) => l.includes('docs/grown.md') && l.includes('> 1 MB'))).toBe(true);
    // contract: a doc that would exceed the budget keeps its token count but no text
    expect(by['insights/huge.md']).toMatchObject({ status: 'over_budget', tokens: 13000, text: null });
    expect(trace.specs_read).toEqual(['specs/a.md', 'docs/empty.md']);
    await h.app.close();
  });

  // ------------------------------------------------------------------ AC-27
  it('AC-27: the attachment tab\'s token estimates equal the trace tokens of the same files', async () => {
    const h = await makeApp();
    const { repo, pr } = await setup({
      'specs/a.md': '# Public API\n\nModule api/ must not import db/ directly.\n',
      'docs/b.md': 'Some longer architecture notes, with punctuation; and numbers 1234.',
      'docs/empty.md': '',
    });
    const agent = await mkAgent(h);
    const skill = await mkSkill(h);
    await bind(h, agent.id, [skill.id]);
    await attach(h, 'agents', agent.id, repo.id, ['specs/a.md', 'docs/empty.md']);
    await attach(h, 'skills', skill.id, repo.id, ['docs/b.md']);

    const tab = (await h.app.inject({ method: 'GET', url: `/agents/${agent.id}/context?repo_id=${repo.id}` })).json() as Json;
    const tabTokens = [...tab.docs, ...tab.inherited].map((x: Json) => x.tokens as number);
    const { trace } = await review(h, agent.id, pr.id);
    const traceTokens = trace.prompt_assembly.spec_blocks.map((b: Json) => b.tokens as number);

    // contract: same text + same tokenizer -> same numbers, in effective-set order; nothing skipped
    expect(trace.prompt_assembly.spec_blocks.every((b: Json) => b.status === 'attached')).toBe(true);
    expect(tabTokens).toEqual(traceTokens);
    expect(tabTokens.reduce((a, b) => a + b, 0)).toBe(traceTokens.reduce((a: number, b: number) => a + b, 0));
    expect(tabTokens[1]).toBe(0);
    await h.app.close();
  });
});
