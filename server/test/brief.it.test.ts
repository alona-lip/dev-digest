import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { cleanupClones, makeClone } from './helpers/project-context-fixtures.js';
import {
  FakeGitHub,
  ScriptedLLM,
  SwitchableGit,
  captureLogLines,
  countCalls,
  diffOf,
  inventedOutput,
  insertBriefPr,
  validOutput,
} from './helpers/brief-fixtures.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder } from '../src/adapters/mocks.js';
import { resolveFeatureModel } from '../src/modules/settings/feature-models.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[brief] Docker not available — skipping integration tests.');

const env = (extra: Record<string, string> = {}) =>
  ({ ...process.env, NODE_ENV: 'test', CONTEXT_GLOB: '', ...extra }) as NodeJS.ProcessEnv;

type Json = Record<string, any>;
type App = Awaited<ReturnType<typeof buildApp>>;

d('PR brief routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: App;
  let llm: ScriptedLLM;
  let git: SwitchableGit;
  let github: FakeGitHub;
  let ghCalls: ReturnType<typeof countCalls<FakeGitHub>>;
  const extraApps: App[] = [];

  const db = () => pg.handle.db;
  const mkOverrides = (l: ScriptedLLM, g: SwitchableGit, gh: FakeGitHub) => ({
    embedder: new MockEmbedder(),
    git: g,
    github: gh,
    llm: { openai: l, openrouter: l },
  });

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
    llm = new ScriptedLLM('openai', {});
    git = new SwitchableGit({});
    github = new FakeGitHub();
    ghCalls = countCalls(github);
    app = await buildApp({
      config: loadConfig(env()),
      db: db(),
      overrides: mkOverrides(llm, git, ghCalls.proxy),
    });
  });
  afterAll(async () => {
    await app?.close();
    for (const a of extraApps) await a.close();
    await pg?.stop();
    await cleanupClones();
  });

  // Every case starts from a known mock state; PRs/repos are fresh per case.
  beforeEach(() => {
    llm.calls = [];
    llm.failWith = null;
    llm.output = validOutput('src/a.ts');
    git.raw = diffOf('src/a.ts');
    github.files = [];
    ghCalls.reset();
  });

  const getBrief = async (id: string) => {
    const r = await app.inject({ method: 'GET', url: `/pulls/${id}/brief` });
    return { status: r.statusCode, body: r.json() as Json };
  };
  const postBrief = async (id: string, a: App = app) => {
    const r = await a.inject({ method: 'POST', url: `/pulls/${id}/brief` });
    return { status: r.statusCode, body: r.json() as Json };
  };
  const rowText = async (prId: string): Promise<string | undefined> => {
    const rows = (await db().execute(
      sql`select json::text as j from pr_brief where pr_id = ${prId}`,
    )) as unknown as { j: string }[];
    return rows[0]?.j;
  };
  const rowCount = async (prId: string): Promise<number> =>
    (await db().select().from(t.prBrief).where(eq(t.prBrief.prId, prId))).length;
  const modelCalls = () => llm.structuredCalls().length;

  // ------------------------------------------------------------------ reads
  describe('GET /pulls/:id/brief', () => {
    it('AC-3: a PR with no stored brief answers 200 { status: "none" }', async () => {
      const { pr } = await insertBriefPr(db(), workspaceId);
      const { status, body } = await getBrief(pr.id);
      // contract: nothing stored -> success status with exactly { status: 'none' }
      expect(status).toBe(200);
      expect(body).toEqual({ status: 'none' });
      expect(await rowCount(pr.id)).toBe(0);
    });

    it('AC-4: a stored brief is read as ready from storage with 0 model calls and 0 GitHub calls', async () => {
      const { pr } = await insertBriefPr(db(), workspaceId);
      const gen = await postBrief(pr.id);
      expect(gen.status).toBe(200);
      llm.calls = [];
      ghCalls.reset();

      const { status, body } = await getBrief(pr.id);
      // contract: ready + stale + current_head_sha + brief, and the read never calls LLM or GitHub
      expect(status).toBe(200);
      expect(body).toMatchObject({
        status: 'ready',
        stale: false,
        current_head_sha: pr.headSha,
        brief: { pr_id: pr.id, head_sha: pr.headSha, summary: 'Adds a thing.' },
      });
      expect(llm.calls).toHaveLength(0);
      expect(ghCalls.count()).toBe(0);
    });

    it('AC-5: stale is true exactly when pull_requests.head_sha differs from the stored head_sha', async () => {
      const { pr } = await insertBriefPr(db(), workspaceId);
      await postBrief(pr.id);

      // contract: unchanged head -> not stale
      expect((await getBrief(pr.id)).body).toMatchObject({ status: 'ready', stale: false });

      await db().update(t.pullRequests).set({ headSha: 'moved-head-sha' }).where(eq(t.pullRequests.id, pr.id));
      // contract: head moved after generation -> stale, and the new head is reported
      expect((await getBrief(pr.id)).body).toMatchObject({
        status: 'ready',
        stale: true,
        current_head_sha: 'moved-head-sha',
        brief: { head_sha: pr.headSha },
      });

      await db().update(t.pullRequests).set({ headSha: pr.headSha }).where(eq(t.pullRequests.id, pr.id));
      // contract: head back to the stored one -> not stale again
      expect((await getBrief(pr.id)).body).toMatchObject({ stale: false });
    });

    it('AC-27: a read makes no model call and no GitHub call in the none, ready and stale states', async () => {
      const { pr } = await insertBriefPr(db(), workspaceId);

      // contract: none
      await getBrief(pr.id);
      await postBrief(pr.id);
      llm.calls = [];
      ghCalls.reset();
      // contract: ready
      await getBrief(pr.id);
      // contract: stale
      await db().update(t.pullRequests).set({ headSha: 'newer-sha' }).where(eq(t.pullRequests.id, pr.id));
      const stale = await getBrief(pr.id);
      expect(stale.body.stale).toBe(true);

      expect(llm.calls).toHaveLength(0);
      expect(ghCalls.count()).toBe(0);

      const { pr: fresh } = await insertBriefPr(db(), workspaceId);
      await getBrief(fresh.id);
      expect(llm.calls).toHaveLength(0);
      expect(ghCalls.count()).toBe(0);
    });

    it('AC-6: an unknown PR id answers 404 for read and generate, with no model call', async () => {
      const unknown = '00000000-0000-4000-8000-000000000001';
      // contract: not found on both verbs, nothing called
      expect((await getBrief(unknown)).status).toBe(404);
      expect((await postBrief(unknown)).status).toBe(404);
      expect(llm.calls).toHaveLength(0);
      expect(ghCalls.count()).toBe(0);
    });

    it("AC-6: another workspace's PR answers 404 for read and generate, with no model call", async () => {
      const [other] = await db().insert(t.workspaces).values({ name: 'other-ws-brief' }).returning();
      const { pr } = await insertBriefPr(db(), other!.id);

      // contract: tenancy — the PR exists but belongs to a different workspace
      expect((await getBrief(pr.id)).status).toBe(404);
      expect((await postBrief(pr.id)).status).toBe(404);
      expect(llm.calls).toHaveLength(0);
      expect(ghCalls.count()).toBe(0);
      expect(await rowCount(pr.id)).toBe(0);
    });

    it('AC-7: a legacy pr_brief row is read as none (200) and logs a warning', async () => {
      const logApp = await buildApp({
        config: loadConfig(env({ LOG_LEVEL: 'warn' })),
        db: db(),
        overrides: mkOverrides(llm, git, ghCalls.proxy),
      });
      extraApps.push(logApp);
      const { pr } = await insertBriefPr(db(), workspaceId);
      await db().insert(t.prBrief).values({ prId: pr.id, json: { intent: 'legacy shape without the brief fields' } });

      const { result, lines } = await captureLogLines(() =>
        logApp.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` }),
      );

      // contract: never a server error; the stale row reads as none
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({ status: 'none' });
      // contract: exactly one warning-level (pino level 40) line about this PR
      const warns = lines.filter((l) => l.level === 40 && l.prId === pr.id);
      expect(warns).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------- generation
  describe('POST /pulls/:id/brief', () => {
    it('AC-23: the POST response equals the next GET and pr_brief holds one row, even after a regeneration', async () => {
      const { pr } = await insertBriefPr(db(), workspaceId);
      const first = await postBrief(pr.id);
      expect(first.status).toBe(200);
      llm.output = validOutput('src/a.ts', 'Second summary.');
      const second = await postBrief(pr.id);

      // contract: ready, not stale, stored against the head the PR had when generation started
      expect(second.body).toMatchObject({
        status: 'ready',
        stale: false,
        current_head_sha: pr.headSha,
        brief: { pr_id: pr.id, head_sha: pr.headSha, summary: 'Second summary.' },
      });
      // contract: the response is exactly what a later read returns
      expect((await getBrief(pr.id)).body).toEqual(second.body);
      // contract: a new brief replaces the previous one — one row per PR
      expect(await rowCount(pr.id)).toBe(1);
    });

    it('AC-37: when validation drops every risk and focus item the brief is still stored with its summary', async () => {
      const { pr } = await insertBriefPr(db(), workspaceId);
      llm.output = inventedOutput();

      const { status, body } = await postBrief(pr.id);

      // contract: 200, summary kept, both lists empty
      expect(status).toBe(200);
      expect(body.status).toBe('ready');
      expect(body.brief.summary).toBe('Only invented paths below.');
      expect(body.brief.risks).toEqual([]);
      expect(body.brief.review_focus).toEqual([]);
      expect(await rowCount(pr.id)).toBe(1);
      expect((await getBrief(pr.id)).body).toEqual(body);
    });

    it('AC-21: a PR with no changed files answers 422 no_changed_files, with no model call and nothing stored', async () => {
      const { pr } = await insertBriefPr(db(), workspaceId);
      git.raw = '';
      github.files = [];

      const { status, body } = await postBrief(pr.id);

      // contract: validation error coded no_changed_files
      expect(status).toBe(422);
      expect(body.error.code).toBe('no_changed_files');
      expect(modelCalls()).toBe(0);
      expect(await rowCount(pr.id)).toBe(0);
    });

    it('AC-24: a failing model call answers an error and leaves the stored pr_brief JSON byte-identical', async () => {
      const { pr } = await insertBriefPr(db(), workspaceId);
      expect((await postBrief(pr.id)).status).toBe(200);
      const before = await rowText(pr.id);
      expect(before).toBeTruthy();

      llm.failWith = new Error('provider exploded');
      const { status, body } = await postBrief(pr.id);

      // contract: external-service error (502), nothing written
      expect(status).toBe(502);
      expect(body.error).toBeTruthy();
      expect(modelCalls()).toBe(2);
      expect(await rowText(pr.id)).toBe(before);
      // contract: the previous brief is still served
      expect((await getBrief(pr.id)).body).toMatchObject({ status: 'ready', brief: { summary: 'Adds a thing.' } });
    });

    it('AC-24: a failing first generation writes no row at all', async () => {
      const { pr } = await insertBriefPr(db(), workspaceId);
      llm.failWith = new Error('provider exploded');

      const { status } = await postBrief(pr.id);

      expect(status).toBe(502);
      expect(await rowCount(pr.id)).toBe(0);
      expect((await getBrief(pr.id)).body).toEqual({ status: 'none' });
    });

    it('AC-20: untrimmable input over the budget answers 422 brief_input_too_large with 0 model calls and the previous row unchanged', async () => {
      const { pr } = await insertBriefPr(db(), workspaceId);
      expect((await postBrief(pr.id)).status).toBe(200);
      const before = await rowText(pr.id);
      llm.calls = [];

      git.raw = diffOf(...Array.from({ length: 2000 }, (_, i) => `src/gen/file-${i}.ts`));
      const { status, body } = await postBrief(pr.id);

      // contract: validation error coded brief_input_too_large, no model call, nothing overwritten
      expect(status).toBe(422);
      expect(body.error.code).toBe('brief_input_too_large');
      expect(modelCalls()).toBe(0);
      expect(await rowText(pr.id)).toBe(before);
    });
  });

  // ------------------------------------------------------------- feature model
  describe('risk_brief feature model', () => {
    it('AC-9: changing the risk_brief setting changes the model id sent to the LLM and brief.model', async () => {
      const original = await resolveFeatureModel(app.container, workspaceId, 'risk_brief');
      const setModel = (provider: string, model: string) =>
        app.inject({ method: 'PUT', url: '/settings', payload: { feature_models: { risk_brief: { provider, model } } } });
      const lastModel = () => {
        const calls = llm.structuredCalls();
        return (calls[calls.length - 1]!.req as { model: string }).model;
      };
      try {
        const { pr } = await insertBriefPr(db(), workspaceId);

        expect((await setModel('openai', 'brief-model-a')).statusCode).toBe(200);
        const a = await postBrief(pr.id);
        // contract: the model comes from the setting, never a hard-coded value
        expect(lastModel()).toBe('brief-model-a');
        expect(a.body.brief.model).toBe('openai/brief-model-a');

        expect((await setModel('openrouter', 'vendor/brief-model-b')).statusCode).toBe(200);
        const b = await postBrief(pr.id);
        expect(lastModel()).toBe('vendor/brief-model-b');
        expect(b.body.brief.model).toBe('openrouter/vendor/brief-model-b');
      } finally {
        await setModel(original.provider, original.model);
      }
    });
  });

  // ---------------------------------------------------------- project documents
  describe('attached project-context documents', () => {
    const DOCS: Record<string, string> = {
      'specs/a.md': '# A\nMARKER-DOC-AAA',
      'specs/b.md': '# B\nMARKER-DOC-BBB',
      'specs/c.md': '# C\nMARKER-DOC-CCC',
      'specs/d.md': '# D\nMARKER-DOC-DDD',
    };
    let agentSeq = 0;
    const mkAgent = async (name: string): Promise<string> => {
      const r = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `${name}-${agentSeq++}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'p' },
      });
      return (r.json() as Json).id as string;
    };
    const attach = async (agentId: string, repoId: string, paths: string[]) => {
      const r = await app.inject({
        method: 'PUT',
        url: `/agents/${agentId}/context`,
        payload: { repo_id: repoId, paths },
      });
      expect(r.statusCode).toBe(200);
    };
    const setCreatedAt = (agentId: string, iso: string) =>
      db().update(t.agents).set({ createdAt: new Date(iso) }).where(eq(t.agents.id, agentId));

    it('AC-15: the documents are the union over enabled agents in creation order; a disabled agent adds none; a repeated path keeps its first position', async () => {
      const clone = await makeClone(DOCS);
      const { repo, pr } = await insertBriefPr(db(), workspaceId, { clonePath: clone });
      // names sort the opposite way to creation order, so name order cannot pass by accident
      const first = await mkAgent('zz-created-first');
      const second = await mkAgent('aa-created-second');
      const disabled = await mkAgent('mm-disabled');
      await setCreatedAt(first, '2026-01-01T00:00:00Z');
      await setCreatedAt(second, '2026-01-02T00:00:00Z');
      await setCreatedAt(disabled, '2026-01-03T00:00:00Z');
      await attach(first, repo.id, ['specs/b.md', 'specs/a.md']);
      await attach(second, repo.id, ['specs/c.md', 'specs/a.md']);
      await attach(disabled, repo.id, ['specs/d.md']);
      const off = await app.inject({ method: 'PUT', url: `/agents/${disabled}`, payload: { enabled: false } });
      expect(off.statusCode).toBe(200);

      expect((await postBrief(pr.id)).status).toBe(200);
      const input = llm.lastInput();
      const pos = (m: string) => input.indexOf(m);

      // contract: first agent's docs (b, a), then the second agent's new docs (c); a is not repeated
      expect(pos('MARKER-DOC-BBB')).toBeGreaterThan(-1);
      expect(pos('MARKER-DOC-AAA')).toBeGreaterThan(pos('MARKER-DOC-BBB'));
      expect(pos('MARKER-DOC-CCC')).toBeGreaterThan(pos('MARKER-DOC-AAA'));
      expect(input.split('MARKER-DOC-AAA').length - 1).toBe(1);
      // contract: a disabled agent's document is absent
      expect(pos('MARKER-DOC-DDD')).toBe(-1);
    });

    it('AC-16: an attached document missing from the clone is skipped; the readable one is still sent', async () => {
      const clone = await makeClone(DOCS);
      const { repo, pr } = await insertBriefPr(db(), workspaceId, { clonePath: clone });
      const agent = await mkAgent('ctx-skip');
      await attach(agent, repo.id, ['specs/a.md', 'specs/b.md']);
      await rm(join(clone, 'specs/b.md'));

      const { status, body } = await postBrief(pr.id);

      // contract: only the readable document reaches the model; not reported missing as a whole
      expect(status).toBe(200);
      const input = llm.lastInput();
      expect(input).toContain('MARKER-DOC-AAA');
      expect(input).not.toContain('MARKER-DOC-BBB');
      expect(body.brief.missing_inputs.filter((m: Json) => m.input === 'specs')).toEqual([]);
    });

    it('AC-16: when every attached document is unreadable, missing_inputs records specs', async () => {
      const clone = await makeClone(DOCS);
      const { repo, pr } = await insertBriefPr(db(), workspaceId, { clonePath: clone });
      const agent = await mkAgent('ctx-allgone');
      await attach(agent, repo.id, ['specs/a.md', 'specs/b.md']);
      await rm(join(clone, 'specs/a.md'));
      await rm(join(clone, 'specs/b.md'));

      const { status, body } = await postBrief(pr.id);

      // contract: brief still generated, specs named as a missing input (clone exists -> unreadable)
      expect(status).toBe(200);
      expect(body.brief.missing_inputs).toContainEqual({ input: 'specs', reason: 'unreadable' });
      expect(llm.lastInput()).not.toContain('MARKER-DOC-');
    });
  });

  // -------------------------------------------------------------- rate limit
  describe('rate limit', () => {
    it('AC-26: the 11th generate request within a minute answers 429 without a model call', async () => {
      // @fastify/rate-limit is not registered when nodeEnv === 'test' (src/app.ts), so build a non-test app.
      const rlLlm = new ScriptedLLM('openai', {});
      rlLlm.output = validOutput('src/a.ts');
      const rlApp = await buildApp({
        config: loadConfig(env({ NODE_ENV: 'development', LOG_LEVEL: 'silent' })),
        db: db(),
        overrides: mkOverrides(rlLlm, git, ghCalls.proxy),
      });
      extraApps.push(rlApp);
      const { pr } = await insertBriefPr(db(), workspaceId);

      for (let i = 1; i <= 10; i++) {
        const r = await postBrief(pr.id, rlApp);
        // contract: the first 10 within the window are served
        expect(r.status, `request ${i}`).toBe(200);
      }
      expect(rlLlm.structuredCalls()).toHaveLength(10);

      const eleventh = await postBrief(pr.id, rlApp);

      // contract: too many requests, and no additional model call
      expect(eleventh.status).toBe(429);
      expect(rlLlm.structuredCalls()).toHaveLength(10);

      // the free read is not rate limited by the generate cap
      const read = await rlApp.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
      expect(read.statusCode).toBe(200);
    });
  });
});
