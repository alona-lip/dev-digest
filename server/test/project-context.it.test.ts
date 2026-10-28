import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { symlink, truncate, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { cleanupClones, insertRepo, makeClone, writeFiles } from './helpers/project-context-fixtures.js';
import { buildApp } from '../src/app.js';
import { DEFAULT_CONTEXT_GLOB, loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[project-context] Docker not available — skipping integration tests.');

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test', CONTEXT_GLOB: '' } as NodeJS.ProcessEnv);

type Json = Record<string, any>;

d('project context routes (Testcontainers pg + fixture clone)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let llm: MockLLMProvider;
  let openrouter: MockLLMProvider;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    llm = new MockLLMProvider('openai', {});
    openrouter = new MockLLMProvider('openai', {});
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({}),
        github: new MockGitHubClient(),
        llm: { openai: llm, openrouter },
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
    await cleanupClones();
  });

  let seq = 0;
  const uniq = (s: string) => `${s}-${seq++}`;
  const db = () => pg.handle.db;

  const get = async (url: string) => {
    const r = await app.inject({ method: 'GET', url });
    return { status: r.statusCode, body: r.json() as Json };
  };
  const put = async (url: string, payload: unknown) => {
    const r = await app.inject({ method: 'PUT', url, payload: payload as object });
    return { status: r.statusCode, body: r.json() as Json };
  };
  const mkAgent = async () =>
    (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: uniq('ctx-agent'), provider: 'openai', model: 'gpt-4.1', system_prompt: 'p' },
      })
    ).json() as Json;
  const mkSkill = async (extra: object = {}) =>
    (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: uniq('ctx-skill'), description: 'Use when x.', type: 'rubric', body: 'Rule.', ...extra },
      })
    ).json() as Json;
  const bindSkills = (agentId: string, skills: { skill_id: string; enabled: boolean }[]) =>
    app.inject({ method: 'PUT', url: `/agents/${agentId}/skills`, payload: { skills } });

  const BASE: Record<string, string> = {
    'specs/a.md': '# A spec',
    'docs/b.md': '# B doc',
    'insights/c.md': '# C insight',
    'e2e/docs/specs/x.md': '# nested',
    'README.md': '# not a context doc',
  };
  const repoWith = async (files: Record<string, string | Uint8Array> = BASE) => {
    const clone = await makeClone(files);
    const repo = await insertRepo(db(), workspaceId, clone);
    return { clone, repo };
  };

  // ---------------------------------------------------------------- list
  describe('GET /repos/:repoId/context', () => {
    it('AC-1: returns exactly the matching .md files (hidden dirs in, node_modules out)', async () => {
      const { repo } = await repoWith({
        ...BASE,
        '.devdigest/specs/h.md': '# hidden',
        'node_modules/p/docs/n.md': '# dep',
      });
      const { status, body } = await get(`/repos/${repo.id}/context`);
      // contract: only glob matches, no excluded dirs, sorted by path
      expect(status).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.glob).toBe(DEFAULT_CONTEXT_GLOB);
      expect(body.docs.map((x: Json) => x.path)).toEqual([
        '.devdigest/specs/h.md',
        'docs/b.md',
        'e2e/docs/specs/x.md',
        'insights/c.md',
        'specs/a.md',
      ]);
      // contract: type = deepest bucket segment
      expect(Object.fromEntries(body.docs.map((x: Json) => [x.path, x.type]))).toMatchObject({
        'e2e/docs/specs/x.md': 'specs',
        'docs/b.md': 'docs',
        'insights/c.md': 'insights',
      });
    });

    it('AC-1: a different glob in server config changes the returned set', async () => {
      const custom = await buildApp({
        config: loadConfig({ ...process.env, NODE_ENV: 'test', CONTEXT_GLOB: '**/*.md' } as NodeJS.ProcessEnv),
        db: db(),
        overrides: { embedder: new MockEmbedder(), git: new MockGitClient({}), github: new MockGitHubClient() },
      });
      try {
        const { repo } = await repoWith();
        const r = (await custom.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json() as Json;
        // contract: the glob is configuration; README.md now matches
        expect(r.docs.map((x: Json) => x.path)).toContain('README.md');
        expect(r.glob).toBe('**/*.md');
      } finally {
        await custom.close();
      }
    });

    it('AC-4: each doc carries path, type, size_bytes, tokens (0 empty, null binary/too large), too_large', async () => {
      const { repo } = await repoWith({
        'docs/text.md': '# hello world',
        'docs/empty.md': '',
        'docs/bin.md': new Uint8Array([0xff, 0xfe, 0x00, 0xc3, 0x28]),
      });
      const { body } = await get(`/repos/${repo.id}/context`);
      const by = Object.fromEntries(body.docs.map((x: Json) => [x.path, x]));
      // contract: shape per the Inputs-and-provenance table
      expect(by['docs/text.md']).toMatchObject({
        path: 'docs/text.md',
        type: 'docs',
        size_bytes: 13,
        too_large: false,
        tokens: expect.any(Number),
      });
      expect(by['docs/text.md'].tokens).toBeGreaterThan(0);
      expect(by['docs/empty.md']).toMatchObject({ size_bytes: 0, tokens: 0, too_large: false });
      expect(by['docs/bin.md']).toMatchObject({ tokens: null, too_large: false });
      expect(typeof body.read_at).toBe('string');
    });

    it('AC-5: 501 matching files -> 500 items in path order and truncated=true', async () => {
      const files: Record<string, string> = {};
      for (let i = 0; i <= 500; i++) files[`docs/f${String(i).padStart(3, '0')}.md`] = `# ${i}`;
      const { repo } = await repoWith(files);
      const { body } = await get(`/repos/${repo.id}/context`);
      expect(body.docs).toHaveLength(500);
      expect(body.truncated).toBe(true);
      expect(body.docs[0].path).toBe('docs/f000.md');
      expect(body.docs[499].path).toBe('docs/f499.md');
    });

    it('AC-5: a repo with fewer than 500 matches is not truncated', async () => {
      const { repo } = await repoWith();
      expect((await get(`/repos/${repo.id}/context`)).body.truncated).toBe(false);
    });

    it('AC-6: a repo that is not cloned returns not_cloned, distinct from an empty list', async () => {
      const notCloned = await insertRepo(db(), workspaceId, null);
      const empty = await repoWith({ 'README.md': '# nothing matching' });
      const a = (await get(`/repos/${notCloned.id}/context`)).body;
      const b = (await get(`/repos/${empty.repo.id}/context`)).body;
      // contract: not_cloned is a status of its own; an empty clone is `ok` with no docs
      expect(a).toMatchObject({ status: 'not_cloned', docs: [] });
      expect(b).toMatchObject({ status: 'ok', docs: [] });
    });

    it('AC-8: a file over 1 MB is listed as too_large with tokens null', async () => {
      const { clone, repo } = await repoWith({ 'docs/small.md': '# s' });
      const big = join(clone, 'docs', 'big.md');
      await writeFile(big, '');
      await truncate(big, 1_153_434);
      const doc = (await get(`/repos/${repo.id}/context`)).body.docs.find((x: Json) => x.path === 'docs/big.md');
      expect(doc).toMatchObject({ too_large: true, tokens: null, size_bytes: 1_153_434 });
    });

    it('AC-13: re-reading picks up a new file and a now-empty file (0 tokens) with no LLM call', async () => {
      const { clone, repo } = await repoWith({ 'docs/shrinks.md': '# lots of text here to count' });
      const before = (await get(`/repos/${repo.id}/context`)).body;
      expect(before.docs.find((x: Json) => x.path === 'docs/shrinks.md').tokens).toBeGreaterThan(0);
      const llmCallsBefore = llm.calls.length + openrouter.calls.length;

      await writeFiles(clone, { 'docs/new.md': '# new', 'docs/shrinks.md': '' });
      const after = (await get(`/repos/${repo.id}/context`)).body;
      // contract: refresh reflects the clone's current state
      expect(after.docs.map((x: Json) => x.path)).toContain('docs/new.md');
      expect(after.docs.find((x: Json) => x.path === 'docs/shrinks.md').tokens).toBe(0);
      // contract: no LLM calls on refresh
      expect(llm.calls.length + openrouter.calls.length).toBe(llmCallsBefore);
    });

    it('cross-workspace: a repo of another workspace is 404', async () => {
      const [ws2] = await db().insert(t.workspaces).values({ name: uniq('other-ws') }).returning();
      const foreign = await insertRepo(db(), ws2!.id, await makeClone(BASE));
      expect((await get(`/repos/${foreign.id}/context`)).status).toBe(404);
      expect((await get(`/repos/${foreign.id}/context/file?path=specs/a.md`)).status).toBe(404);
      expect((await get(`/repos/${foreign.id}/context/usage`)).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------- file
  describe('GET /repos/:repoId/context/file', () => {
    it('AC-7: a valid path returns the text, type and tokens', async () => {
      const { repo } = await repoWith();
      const { status, body } = await get(`/repos/${repo.id}/context/file?path=specs/a.md`);
      expect(status).toBe(200);
      expect(body).toMatchObject({ path: 'specs/a.md', type: 'specs', content: '# A spec', tokens: expect.any(Number) });
    });

    it('AC-7: traversal, glob miss, node_modules and a missing file are 404 with no content', async () => {
      const { repo } = await repoWith({ ...BASE, 'node_modules/p/docs/n.md': '# dep' });
      for (const p of [
        '../../etc/passwd',
        '..%2F..%2Fetc%2Fpasswd',
        '/etc/passwd',
        'README.md',
        'node_modules/p/docs/n.md',
        'docs/nope.md',
      ]) {
        const r = await get(`/repos/${repo.id}/context/file?path=${p}`);
        // contract: "not found" and never any content
        expect(r.status, p).toBe(404);
        expect(r.body.content, p).toBeUndefined();
      }
    });

    it('AC-7: a symlinked file or directory pointing outside the clone is 404', async () => {
      const outside = await makeClone({ 'secret.md': '# TOP-SECRET', 'docs/secret.md': '# TOP-SECRET' });
      const { clone, repo } = await repoWith();
      await symlink(join(outside, 'secret.md'), join(clone, 'docs', 'link.md'));
      await symlink(outside, join(clone, 'docs', 'extdir'));
      for (const p of ['docs/link.md', 'docs/extdir/docs/secret.md']) {
        const r = await get(`/repos/${repo.id}/context/file?path=${p}`);
        expect(r.status, p).toBe(404);
        expect(JSON.stringify(r.body)).not.toContain('TOP-SECRET');
      }
    });

    it('AC-7: a symlinked directory pointing into node_modules must not expose a document', async () => {
      // AMBIGUOUS (see report): reading "not excluded" to include the resolved target.
      const { clone, repo } = await repoWith({ ...BASE, 'node_modules/pkg/readme.md': '# dep readme' });
      await symlink(join(clone, 'node_modules', 'pkg'), join(clone, 'docs', 'nm'));
      expect((await get(`/repos/${repo.id}/context/file?path=docs/nm/readme.md`)).status).toBe(404);
    });

    it('AC-8: a file over 1 MB returns an error with the reason and no content', async () => {
      const { clone, repo } = await repoWith();
      const big = join(clone, 'docs', 'big.md');
      await writeFile(big, '');
      await truncate(big, 1_153_434);
      const r = await get(`/repos/${repo.id}/context/file?path=docs/big.md`);
      // contract: too large -> an error carrying the reason, never the content
      expect(r.status).toBe(413);
      expect(r.body.error.code).toBe('too_large');
      expect(r.body.content).toBeUndefined();
    });

    it('AC-4: a binary file is not returned as text (415 not_text)', async () => {
      const { repo } = await repoWith({ 'docs/bin.md': new Uint8Array([0xff, 0xfe, 0x00, 0xc3, 0x28]) });
      const r = await get(`/repos/${repo.id}/context/file?path=docs/bin.md`);
      expect(r.status).toBe(415);
      expect(r.body.content).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------- usage
  describe('GET /repos/:repoId/context/usage', () => {
    it('AC-12: counts agents (direct or via an active skill) and skills (direct) per path', async () => {
      const { repo } = await repoWith();
      const [a1, a2, a3] = [await mkAgent(), await mkAgent(), await mkAgent()];
      const s1 = await mkSkill();
      await put(`/agents/${a1.id}/context`, { repo_id: repo.id, paths: ['specs/a.md'] });
      await put(`/skills/${s1.id}/context`, { repo_id: repo.id, paths: ['specs/a.md', 'docs/b.md'] });
      await bindSkills(a2.id, [{ skill_id: s1.id, enabled: true }]);
      await bindSkills(a3.id, [{ skill_id: s1.id, enabled: false }]); // disabled for this agent

      const { status, body } = await get(`/repos/${repo.id}/context/usage`);
      expect(status).toBe(200);
      // contract: a.md -> agents {A1 direct, A2 via S1}; b.md -> {A2 via S1}; A3 inherits nothing
      expect(body.by_path['specs/a.md']).toEqual({ agents: 2, skills: 1 });
      expect(body.by_path['docs/b.md']).toEqual({ agents: 1, skills: 1 });
    });

    it('AC-12: usage is scoped to this repository', async () => {
      const r1 = await repoWith();
      const r2 = await repoWith();
      const a = await mkAgent();
      await put(`/agents/${a.id}/context`, { repo_id: r1.repo.id, paths: ['specs/a.md'] });
      expect((await get(`/repos/${r2.repo.id}/context/usage`)).body.by_path).toEqual({});
    });
  });

  // ---------------------------------------------------------------- attachments (agent + skill)
  describe.each([['agent'], ['skill']] as const)('%s attachments', (kind) => {
    const mkOwner = () => (kind === 'agent' ? mkAgent() : mkSkill());
    const url = (id: string) => `/${kind}s/${id}/context`;
    const rows = async (id: string) =>
      kind === 'agent'
        ? db().select().from(t.agentContextDocs).where(eq(t.agentContextDocs.agentId, id))
        : db().select().from(t.skillContextDocs).where(eq(t.skillContextDocs.skillId, id));

    it('AC-22: PUT replaces the whole ordered list and GET returns the same order', async () => {
      const { repo } = await repoWith();
      const o = await mkOwner();
      const first = await put(url(o.id), { repo_id: repo.id, paths: ['specs/a.md', 'docs/b.md', 'insights/c.md'] });
      expect(first.status).toBe(200);
      // contract: order of paths is preserved
      expect((await get(`${url(o.id)}?repo_id=${repo.id}`)).body.paths).toEqual([
        'specs/a.md',
        'docs/b.md',
        'insights/c.md',
      ]);
      await put(url(o.id), { repo_id: repo.id, paths: ['insights/c.md', 'specs/a.md'] });
      const again = (await get(`${url(o.id)}?repo_id=${repo.id}`)).body;
      // contract: a save replaces the whole list (docs/b.md detached) in the new order
      expect(again.paths).toEqual(['insights/c.md', 'specs/a.md']);
      expect(again.docs.map((x: Json) => x.path)).toEqual(['insights/c.md', 'specs/a.md']);
      await put(url(o.id), { repo_id: repo.id, paths: [] });
      expect((await get(`${url(o.id)}?repo_id=${repo.id}`)).body.paths).toEqual([]);
    });

    it('AC-22: attachments are per repository', async () => {
      const r1 = await repoWith();
      const r2 = await repoWith();
      const o = await mkOwner();
      await put(url(o.id), { repo_id: r1.repo.id, paths: ['specs/a.md'] });
      expect((await get(`${url(o.id)}?repo_id=${r2.repo.id}`)).body.paths).toEqual([]);
    });

    it('AC-33/AC-35: invalid paths -> 422 and nothing saved', async () => {
      const { clone, repo } = await repoWith({ ...BASE, 'node_modules/p/docs/n.md': '# dep' });
      const outside = await makeClone({ 'docs/s.md': '# s' });
      await symlink(join(outside, 'docs/s.md'), join(clone, 'docs', 'link.md'));
      const big = join(clone, 'docs', 'big.md');
      await writeFile(big, '');
      await truncate(big, 1_153_434);
      const o = await mkOwner();
      for (const bad of [
        '../secret.md',
        '/etc/passwd',
        'docs/does-not-exist.md',
        'README.md',
        'node_modules/p/docs/n.md',
        'docs/link.md',
        'docs/big.md',
      ]) {
        // contract: one bad path rejects the whole save; nothing is stored
        const r = await put(url(o.id), { repo_id: repo.id, paths: ['specs/a.md', bad] });
        expect(r.status, bad).toBe(422);
        expect(await rows(o.id), bad).toHaveLength(0);
      }
    });

    it('AC-33/AC-35: an empty .md is accepted', async () => {
      const { repo } = await repoWith({ ...BASE, 'docs/empty.md': '' });
      const o = await mkOwner();
      const r = await put(url(o.id), { repo_id: repo.id, paths: ['docs/empty.md'] });
      expect(r.status).toBe(200);
      expect(r.body.docs[0]).toMatchObject({ path: 'docs/empty.md', tokens: 0, missing: false });
    });

    it('AC-33/AC-35: the path at position 501 (beyond the list limit) is accepted and not missing', async () => {
      const files: Record<string, string> = {};
      for (let i = 0; i <= 500; i++) files[`docs/f${String(i).padStart(3, '0')}.md`] = `# ${i}`;
      const { repo } = await repoWith(files);
      const o = await mkOwner();
      const r = await put(url(o.id), { repo_id: repo.id, paths: ['docs/f500.md'] });
      expect(r.status).toBe(200);
      // AC-31: a path past the 500-item list is still in the full set, so it is NOT missing
      expect(r.body.docs[0]).toMatchObject({ path: 'docs/f500.md', missing: false });
      expect((await get(`${url(o.id)}?repo_id=${repo.id}`)).body.docs[0].missing).toBe(false);
    });

    it('AC-31: a path deleted from the clone is returned with missing=true and can be detached', async () => {
      const { clone, repo } = await repoWith();
      const o = await mkOwner();
      await put(url(o.id), { repo_id: repo.id, paths: ['specs/a.md', 'docs/b.md'] });
      await rm(join(clone, 'docs', 'b.md'));
      const body = (await get(`${url(o.id)}?repo_id=${repo.id}`)).body;
      expect(body.paths).toEqual(['specs/a.md', 'docs/b.md']);
      expect(body.docs.find((x: Json) => x.path === 'docs/b.md')).toMatchObject({ missing: true });
      expect(body.docs.find((x: Json) => x.path === 'specs/a.md')).toMatchObject({ missing: false });
      // contract: detaching the missing row saves the list without it
      expect((await put(url(o.id), { repo_id: repo.id, paths: ['specs/a.md'] })).status).toBe(200);
    });

    it('AC-37: stored rows are pointers only - no document text', async () => {
      const { repo } = await repoWith({ 'docs/secret.md': '# UNIQUE-FILE-CONTENT-9f3a' });
      const o = await mkOwner();
      await put(url(o.id), { repo_id: repo.id, paths: ['docs/secret.md'] });
      const stored = await rows(o.id);
      expect(stored).toHaveLength(1);
      // contract: only (workspace, owner, repo, path, order) are stored
      expect(Object.keys(stored[0]!).sort()).toEqual(
        ['createdAt', 'id', 'path', 'position', 'repoId', 'workspaceId', kind === 'agent' ? 'agentId' : 'skillId'].sort(),
      );
      expect(JSON.stringify(stored)).not.toContain('UNIQUE-FILE-CONTENT');
      expect(stored[0]).toMatchObject({ path: 'docs/secret.md', position: 0, workspaceId });
    });

    it('AC-38: deleting the owner deletes its attachments', async () => {
      const { repo } = await repoWith();
      const o = await mkOwner();
      await put(url(o.id), { repo_id: repo.id, paths: ['specs/a.md'] });
      expect(await rows(o.id)).toHaveLength(1);
      expect((await app.inject({ method: 'DELETE', url: `/${kind}s/${o.id}` })).statusCode).toBe(200);
      expect(await rows(o.id)).toHaveLength(0);
    });

    it('AC-38: deleting the repository deletes its attachments', async () => {
      const { repo } = await repoWith();
      const o = await mkOwner();
      await put(url(o.id), { repo_id: repo.id, paths: ['specs/a.md'] });
      expect((await app.inject({ method: 'DELETE', url: `/repos/${repo.id}` })).statusCode).toBe(200);
      expect(await rows(o.id)).toHaveLength(0);
    });

    it('cross-workspace: an owner or repo of another workspace is 404 and saves nothing', async () => {
      const { repo } = await repoWith();
      const [ws2] = await db().insert(t.workspaces).values({ name: uniq('other-ws') }).returning();
      const foreignRepo = await insertRepo(db(), ws2!.id, await makeClone(BASE));
      const foreignOwner =
        kind === 'agent'
          ? (
              await db()
                .insert(t.agents)
                .values({ workspaceId: ws2!.id, name: uniq('fa'), provider: 'openai', model: 'm', systemPrompt: 'p' })
                .returning()
            )[0]!
          : (
              await db()
                .insert(t.skills)
                .values({ workspaceId: ws2!.id, name: uniq('fs'), description: 'd', type: 'custom', source: 'manual', body: 'b' })
                .returning()
            )[0]!;
      const mine = await mkOwner();
      expect((await get(`${url(foreignOwner.id)}?repo_id=${repo.id}`)).status).toBe(404);
      expect((await put(url(foreignOwner.id), { repo_id: repo.id, paths: [] })).status).toBe(404);
      expect((await put(url(mine.id), { repo_id: foreignRepo.id, paths: [] })).status).toBe(404);
      expect(await rows(foreignOwner.id)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------- agent-only
  describe('agent inherited rows', () => {
    it('AC-26: lists active skills\' docs as inherited (via skill), once, minus the agent\'s own paths', async () => {
      const { repo } = await repoWith({ ...BASE, 'docs/d.md': '# d', 'docs/e.md': '# e' });
      const agent = await mkAgent();
      const active = await mkSkill();
      const globallyOff = await mkSkill();
      const offForAgent = await mkSkill();
      await app.inject({ method: 'PUT', url: `/skills/${globallyOff.id}`, payload: { enabled: false } });
      await bindSkills(agent.id, [
        { skill_id: active.id, enabled: true },
        { skill_id: globallyOff.id, enabled: true },
        { skill_id: offForAgent.id, enabled: false },
      ]);
      await put(`/skills/${active.id}/context`, { repo_id: repo.id, paths: ['docs/b.md', 'specs/a.md'] });
      await put(`/skills/${globallyOff.id}/context`, { repo_id: repo.id, paths: ['docs/d.md'] });
      await put(`/skills/${offForAgent.id}/context`, { repo_id: repo.id, paths: ['docs/e.md'] });
      await put(`/agents/${agent.id}/context`, { repo_id: repo.id, paths: ['docs/b.md'] });

      const { body } = await get(`/agents/${agent.id}/context?repo_id=${repo.id}`);
      // contract: duplicate of the agent's own path is shown once (as the agent's); disabled skills do not inherit
      expect(body.paths).toEqual(['docs/b.md']);
      expect(body.inherited.map((x: Json) => x.path)).toEqual(['specs/a.md']);
      expect(body.inherited[0].via_skill).toEqual({ skill_id: active.id, name: active.name });
    });

    it('AC-26: a skill\'s own attachment list has no inherited rows', async () => {
      const { repo } = await repoWith();
      const s = await mkSkill();
      await put(`/skills/${s.id}/context`, { repo_id: repo.id, paths: ['specs/a.md'] });
      expect((await get(`/skills/${s.id}/context?repo_id=${repo.id}`)).body.inherited).toEqual([]);
    });
  });

  // ---------------------------------------------------------------- versions
  describe('AC-39 no versions created', () => {
    it('saving attachments does not bump the agent version or add agent/skill versions', async () => {
      const { repo } = await repoWith();
      const agent = await mkAgent();
      const skill = await mkSkill();
      const av = async () => (await get(`/agents/${agent.id}`)).body.version;
      const sv = async () => (await get(`/skills/${skill.id}`)).body.version;
      const [agentV, skillV] = [await av(), await sv()];
      const agentVersionRows = () => db().select().from(t.agentVersions).where(eq(t.agentVersions.agentId, agent.id));
      const skillVersionRows = () => db().select().from(t.skillVersions).where(eq(t.skillVersions.skillId, skill.id));
      const [avRows, svRows] = [(await agentVersionRows()).length, (await skillVersionRows()).length];

      // attach, reorder, detach on both owners
      await put(`/agents/${agent.id}/context`, { repo_id: repo.id, paths: ['specs/a.md', 'docs/b.md'] });
      await put(`/agents/${agent.id}/context`, { repo_id: repo.id, paths: ['docs/b.md', 'specs/a.md'] });
      await put(`/agents/${agent.id}/context`, { repo_id: repo.id, paths: [] });
      await put(`/skills/${skill.id}/context`, { repo_id: repo.id, paths: ['specs/a.md', 'docs/b.md'] });
      await put(`/skills/${skill.id}/context`, { repo_id: repo.id, paths: ['docs/b.md'] });

      // contract: attachments are not part of the versioned config
      expect(await av()).toBe(agentV);
      expect(await sv()).toBe(skillV);
      expect(await agentVersionRows()).toHaveLength(avRows);
      expect(await skillVersionRows()).toHaveLength(svRows);
    });
  });

  // ---------------------------------------------------------------- SPEC-02
  describe('SPEC-02 — INSIGHTS.md documents', () => {
    const MODULES = ['server', 'client', 'reviewer-core', 'e2e', 'mcp-server'];
    const INSIGHTS_FIXTURE: Record<string, string> = {
      ...Object.fromEntries(MODULES.map((m) => [`${m}/INSIGHTS.md`, `# ${m} insights`])),
      'notes/random.md': '# random',
      'node_modules/p/INSIGHTS.md': '# dep insights',
      'Docs/y.md': '# mixed-case docs dir',
      'SPECS/z.md': '# upper-case specs dir',
      'notes/INSIGHTS.MD': '# upper-case extension',
      'README.md': '# readme',
    };
    const LISTED = [
      'Docs/y.md',
      'SPECS/z.md',
      ...MODULES.map((m) => `${m}/INSIGHTS.md`),
    ].sort();
    const ALL_PATHS = Object.keys(INSIGHTS_FIXTURE);

    const envExampleGlob = () => {
      const text = readFileSync(join(import.meta.dirname, '..', '.env.example'), 'utf8');
      return text.split('\n').find((l) => l.startsWith('CONTEXT_GLOB='))!.slice('CONTEXT_GLOB='.length).trim();
    };

    it('SPEC-02 AC-12: glob is a single string equal to the built-in default when CONTEXT_GLOB is unset', async () => {
      const { repo } = await repoWith(INSIGHTS_FIXTURE);
      const { body } = await get(`/repos/${repo.id}/context`);
      // contract: unset glob -> the response names the documented default (also the .env.example value)
      expect(typeof body.glob).toBe('string');
      expect(body.glob).toBe(DEFAULT_CONTEXT_GLOB);
      expect(body.glob).toBe(envExampleGlob());
    });

    it('SPEC-02 AC-8: an INSIGHTS.md is served with its text; node_modules/p/INSIGHTS.md and ../INSIGHTS.md are 404', async () => {
      const { repo } = await repoWith(INSIGHTS_FIXTURE);
      const list = (await get(`/repos/${repo.id}/context`)).body;
      // contract: server/INSIGHTS.md is listed and typed insights
      expect(list.docs.find((x: Json) => x.path === 'server/INSIGHTS.md')).toMatchObject({ type: 'insights' });
      const ok = await get(`/repos/${repo.id}/context/file?path=server/INSIGHTS.md`);
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ path: 'server/INSIGHTS.md', type: 'insights', content: '# server insights' });
      for (const p of ['node_modules/p/INSIGHTS.md', '../INSIGHTS.md', '..%2FINSIGHTS.md']) {
        // contract: excluded directory and traversal are "not found" with no content
        const r = await get(`/repos/${repo.id}/context/file?path=${p}`);
        expect(r.status, p).toBe(404);
        expect(r.body.content, p).toBeUndefined();
      }
    });

    it('SPEC-02 AC-9: saving server/INSIGHTS.md succeeds and is stored; notes/random.md is 422 with 0 rows', async () => {
      const { repo } = await repoWith(INSIGHTS_FIXTURE);
      const agent = await mkAgent();
      const rows = () => db().select().from(t.agentContextDocs).where(eq(t.agentContextDocs.agentId, agent.id));
      // contract: a path inside the rule is accepted and stored
      const bad = await put(`/agents/${agent.id}/context`, { repo_id: repo.id, paths: ['notes/random.md'] });
      expect(bad.status).toBe(422);
      expect(await rows()).toHaveLength(0);
      const good = await put(`/agents/${agent.id}/context`, { repo_id: repo.id, paths: ['server/INSIGHTS.md'] });
      expect(good.status).toBe(200);
      const stored = await rows();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ path: 'server/INSIGHTS.md', position: 0 });
      // contract: mixing an out-of-rule path into a valid save rejects it and leaves the stored row unchanged
      const mixed = await put(`/agents/${agent.id}/context`, {
        repo_id: repo.id,
        paths: ['server/INSIGHTS.md', 'notes/random.md'],
      });
      expect(mixed.status).toBe(422);
      expect(await rows()).toHaveLength(1);
    });

    it('SPEC-02 AC-7: listed <=> content returned <=> attachment accepted for every fixture path', async () => {
      const { repo } = await repoWith(INSIGHTS_FIXTURE);
      const listed = new Set(
        ((await get(`/repos/${repo.id}/context`)).body.docs as Json[]).map((x) => x.path as string),
      );
      // contract: the default rule lists exactly these (AC-1..AC-4 on this fixture)
      expect([...listed].sort()).toEqual(LISTED);
      const agent = await mkAgent();
      for (const p of ALL_PATHS) {
        const isListed = listed.has(p);
        const content = await get(`/repos/${repo.id}/context/file?path=${encodeURIComponent(p)}`);
        const attach = await put(`/agents/${agent.id}/context`, { repo_id: repo.id, paths: [p] });
        // contract: one rule for list, content and attachment validation
        expect(content.status === 200, `content ${p}`).toBe(isListed);
        expect(attach.status === 200, `attach ${p}`).toBe(isListed);
        if (!isListed) {
          expect(content.status, p).toBe(404);
          expect(attach.status, p).toBe(422);
        }
      }
    });

    it('SPEC-02 AC-16: CONTEXT_GLOB set to the default string returns the same docs as unset', async () => {
      const { repo } = await repoWith(INSIGHTS_FIXTURE);
      const explicit = await buildApp({
        config: loadConfig({ ...process.env, NODE_ENV: 'test', CONTEXT_GLOB: DEFAULT_CONTEXT_GLOB } as NodeJS.ProcessEnv),
        db: db(),
        overrides: {
          embedder: new MockEmbedder(),
          git: new MockGitClient({}),
          github: new MockGitHubClient(),
          llm: { openai: new MockLLMProvider('openai', {}), openrouter: new MockLLMProvider('openai', {}) },
        },
      });
      try {
        const unset = (await get(`/repos/${repo.id}/context`)).body;
        const set = (await explicit.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json() as Json;
        // contract: explicit default string behaves identically to unset
        expect(set.glob).toBe(unset.glob);
        expect(set.docs).toEqual(unset.docs);
        const paths = set.docs.map((x: Json) => x.path);
        expect(paths).toContain('Docs/y.md');
        expect(paths).toContain('SPECS/z.md');
        expect(paths).toContain('server/INSIGHTS.md');
      } finally {
        await explicit.close();
      }
    });
  });
});
