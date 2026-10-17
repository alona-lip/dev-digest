import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { zipSync, strToU8 } from 'fflate';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[skills] Docker not available — skipping integration tests.');

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW: Review = {
  verdict: 'request_changes',
  summary: 'x',
  score: 50,
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'r',
      confidence: 0.9,
      kind: 'finding',
    },
  ],
};

const skillBody = (name: string) => ({
  name,
  description: `Use when ${name} applies.`,
  type: 'rubric' as const,
  body: `Rule text for ${name}.`,
});

d('skills module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let llm: MockLLMProvider;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    llm = new MockLLMProvider('openai', { structured: REVIEW });
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        llm: { openai: llm },
      },
    });
  }

  let seq = 0;
  const uniq = (s: string) => `${s}-${seq++}`;

  describe('CRUD + versions', () => {
    it('creates at v1, lists with tokens/rollups, gets, deletes', async () => {
      const app = await makeApp();
      const name = uniq('crud');
      const res = await app.inject({ method: 'POST', url: '/skills', payload: skillBody(name) });
      expect(res.statusCode).toBe(201);
      const skill = res.json();
      expect(skill).toMatchObject({ name, version: 1, enabled: true, source: 'manual' });
      expect(skill.tokens).toBeGreaterThan(0);

      const list = (await app.inject({ method: 'GET', url: '/skills' })).json();
      const item = list.find((s: { id: string }) => s.id === skill.id);
      expect(item).toMatchObject({ agent_count: 0, pull_rate: null, accept_rate: null });

      expect((await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).json().name).toBe(name);
      expect((await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).statusCode).toBe(404);
      await app.close();
    });

    it('rejects a duplicate name with 409 and invalid input with 422', async () => {
      const app = await makeApp();
      const name = uniq('dup');
      await app.inject({ method: 'POST', url: '/skills', payload: skillBody(name) });
      const dup = await app.inject({ method: 'POST', url: '/skills', payload: skillBody(name) });
      expect(dup.statusCode).toBe(409);
      const bad = await app.inject({ method: 'POST', url: '/skills', payload: { ...skillBody('x'), type: 'nope' } });
      expect(bad.statusCode).toBe(422);
      await app.close();
    });

    it('only a changed body makes a new version; enabled/description edits do not', async () => {
      const app = await makeApp();
      const skill = (await app.inject({ method: 'POST', url: '/skills', payload: skillBody(uniq('ver')) })).json();

      const toggled = (await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { enabled: false, description: 'New desc' } })).json();
      expect(toggled).toMatchObject({ version: 1, enabled: false, description: 'New desc' });

      const same = (await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { body: skill.body } })).json();
      expect(same.version).toBe(1);

      const v2 = (await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { body: 'Tightened.', change_note: 'Tightened scope' } })).json();
      expect(v2.version).toBe(2);

      const versions = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` })).json();
      expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
      expect(versions[0]).toMatchObject({ current: true, message: 'Tightened scope', body: 'Tightened.' });
      expect(versions[1]).toMatchObject({ current: false, message: 'Initial version', body: skill.body });
      await app.close();
    });

    it('restore appends a NEW version with the old body (history is never rewritten)', async () => {
      const app = await makeApp();
      const skill = (await app.inject({ method: 'POST', url: '/skills', payload: skillBody(uniq('rest')) })).json();
      await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { body: 'Second.' } });

      const restored = await app.inject({ method: 'POST', url: `/skills/${skill.id}/versions/1/restore` });
      expect(restored.json()).toMatchObject({ version: 3, body: skill.body });
      const versions = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` })).json();
      expect(versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
      expect(versions[0].message).toBe('Restored from v1');

      expect((await app.inject({ method: 'POST', url: `/skills/${skill.id}/versions/3/restore` })).statusCode).toBe(409);
      expect((await app.inject({ method: 'POST', url: `/skills/${skill.id}/versions/99/restore` })).statusCode).toBe(404);
      await app.close();
    });
  });

  describe('import preview', () => {
    it('parses a zip, flags a name clash, and writes NOTHING', async () => {
      const app = await makeApp();
      const name = uniq('imp');
      await app.inject({ method: 'POST', url: '/skills', payload: skillBody(name) });
      const before = (await app.inject({ method: 'GET', url: '/skills' })).json().length;

      const zip = zipSync({
        'pack/SKILL.md': strToU8(`---\nname: ${name}\ndescription: Use when X.\n---\nBody`),
        'pack/run.sh': strToU8('echo pwned'),
      });
      const res = await app.inject({
        method: 'POST',
        url: '/skills/import/preview',
        payload: { filename: 'pack.zip', content_base64: Buffer.from(zip).toString('base64') },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        name,
        name_conflict: true,
        ignored_files: [{ path: 'pack/run.sh', reason: 'executable' }],
      });
      expect((await app.inject({ method: 'GET', url: '/skills' })).json().length).toBe(before);

      const bad = await app.inject({
        method: 'POST',
        url: '/skills/import/preview',
        payload: { filename: 'x.zip', content_base64: Buffer.from('nope').toString('base64') },
      });
      expect(bad.statusCode).toBe(422);
      await app.close();
    });

    it('saving an import goes through POST /skills with source imported_file', async () => {
      const app = await makeApp();
      const res = await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { ...skillBody(uniq('saved')), source: 'imported_file' },
      });
      expect(res.json().source).toBe('imported_file');
      await app.close();
    });
  });

  describe('agent bindings + runs', () => {
    async function setup(app: Awaited<ReturnType<typeof makeApp>>) {
      const mk = async (n: string, extra: object = {}) =>
        (await app.inject({ method: 'POST', url: '/skills', payload: { ...skillBody(uniq(n)), ...extra } })).json();
      const [a, b, c, e] = [await mk('alpha'), await mk('bravo'), await mk('charlie'), await mk('echo')];
      await app.inject({ method: 'PUT', url: `/skills/${c.id}`, payload: { enabled: false } }); // global kill-switch
      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: uniq('Skilled'), provider: 'openai', model: 'gpt-4.1', system_prompt: 'AGENT PROMPT' },
        })
      ).json();
      return { a, b, c, e, agent };
    }

    it('PUT /agents/:id/skills keeps order + per-agent enabled; bumps the agent version only when the ACTIVE set changes', async () => {
      const app = await makeApp();
      const { a, b, c, agent } = await setup(app);
      const put = (skills: { skill_id: string; enabled: boolean }[]) =>
        app.inject({ method: 'PUT', url: `/agents/${agent.id}/skills`, payload: { skills } });

      const r1 = await put([{ skill_id: b.id, enabled: true }, { skill_id: a.id, enabled: true }, { skill_id: c.id, enabled: true }]);
      expect(r1.json().map((l: { skill_id: string }) => l.skill_id)).toEqual([b.id, a.id, c.id]);
      expect((await app.inject({ method: 'GET', url: `/agents/${agent.id}` })).json().version).toBe(2);

      // switching a link on a globally-disabled skill changes nothing in the prompt → no bump
      await put([{ skill_id: b.id, enabled: true }, { skill_id: a.id, enabled: true }, { skill_id: c.id, enabled: false }]);
      expect((await app.inject({ method: 'GET', url: `/agents/${agent.id}` })).json().version).toBe(2);

      // reorder = different prompt → bump, snapshot lists active ids in order
      await put([{ skill_id: a.id, enabled: true }, { skill_id: b.id, enabled: true }]);
      const v3 = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/versions/3` })).json();
      expect(v3.config.skills).toEqual([a.id, b.id]);

      const links = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/skills` })).json();
      expect(links).toEqual([
        { agent_id: agent.id, skill_id: a.id, order: 0, enabled: true },
        { agent_id: agent.id, skill_id: b.id, order: 1, enabled: true },
      ]);
      await app.close();
    });

    it("refuses another workspace's skill and duplicates", async () => {
      const app = await makeApp();
      const { a, agent } = await setup(app);
      const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'other' }).returning();
      const [foreign] = await pg.handle.db
        .insert(t.skills)
        .values({ workspaceId: other!.id, name: 'foreign', description: 'd', type: 'custom', source: 'manual', body: 'b' })
        .returning();
      const put = (skills: unknown[]) => app.inject({ method: 'PUT', url: `/agents/${agent.id}/skills`, payload: { skills } });
      expect((await put([{ skill_id: foreign!.id, enabled: true }])).statusCode).toBe(404);
      expect((await put([{ skill_id: a.id, enabled: true }, { skill_id: a.id, enabled: true }])).statusCode).toBe(422);
      await app.close();
    });

    it('a review puts ONLY enabled skills into the system message, in order, and traces them', async () => {
      const app = await makeApp();
      const { a, b, c, e, agent } = await setup(app);
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/skills`,
        payload: {
          skills: [
            { skill_id: b.id, enabled: true },
            { skill_id: c.id, enabled: true }, // globally disabled
            { skill_id: a.id, enabled: true },
            { skill_id: e.id, enabled: false }, // disabled for this agent
          ],
        },
      });
      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
      const [run] = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

      const call = llm.calls.find((x) => x.method === 'completeStructured')!;
      const sys = (call.req as { messages: { role: string; content: string }[] }).messages[0]!.content;
      expect(sys.indexOf('AGENT PROMPT')).toBeLessThan(sys.indexOf('## Skills'));
      expect(sys.indexOf(`### Skill: ${b.name}`)).toBeLessThan(sys.indexOf(`### Skill: ${a.name}`));
      expect(sys.indexOf(`### Skill: ${a.name}`)).toBeLessThan(sys.indexOf('SECURITY — read carefully'));
      expect(sys).not.toContain(c.name);
      expect(sys).not.toContain(e.name);

      const trace = (await app.inject({ method: 'GET', url: `/runs/${run!.id}/trace` })).json();
      expect(trace.prompt_assembly.skill_blocks.map((x: { name: string }) => x.name)).toEqual([b.name, a.name]);
      expect(trace.prompt_assembly.skill_blocks.every((x: { tokens: number }) => x.tokens > 0)).toBe(true);
      const logs = trace.log.map((l: { msg: string }) => l.msg).join('\n');
      expect(logs).toContain('Skills: 2 attached');
      expect(logs).toContain(`Skill "${b.name}"`);
      expect(logs).not.toContain(c.name);
      expect(logs).not.toContain(e.name);

      const rows = await pg.handle.db.select().from(t.runSkills).where(eq(t.runSkills.runId, run!.id));
      expect(rows.map((r) => [r.skillId, r.order]).sort()).toEqual([[a.id, 1], [b.id, 0]].sort());
      await app.close();
    });

    it('an agent with no skills has no Skills section and no skill_blocks', async () => {
      const app = await makeApp();
      const { agent } = await setup(app);
      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
      const [run] = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
      const call = llm.calls.find((x) => x.method === 'completeStructured')!;
      const sys = (call.req as { messages: { content: string }[] }).messages[0]!.content;
      expect(sys).not.toContain('## Skills');
      const trace = (await app.inject({ method: 'GET', url: `/runs/${run!.id}/trace` })).json();
      expect(trace.prompt_assembly.skill_blocks).toEqual([]);
      await app.close();
    });

    it('stats: pull rate, accept rate and categories come from the runs the skill was in', async () => {
      const app = await makeApp();
      const { a, agent } = await setup(app);
      await app.inject({ method: 'PUT', url: `/agents/${agent.id}/skills`, payload: { skills: [{ skill_id: a.id, enabled: true }] } });

      const empty = (await app.inject({ method: 'GET', url: `/skills/${a.id}/stats` })).json();
      expect(empty).toMatchObject({ pull_rate: null, accept_rate: null, findings_30d: 0, findings_by_category: [] });
      expect(empty.used_by).toEqual([{ agent_id: agent.id, name: agent.name, enabled: true }]);

      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
      const [run1] = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

      // run 1 had the skill; run 2 (after unlinking) does not → pull rate 1/2
      await app.inject({ method: 'PUT', url: `/agents/${agent.id}/skills`, payload: { skills: [] } });
      const stillBound = await app.inject({ method: 'PUT', url: `/agents/${agent.id}/skills`, payload: { skills: [{ skill_id: a.id, enabled: false }] } });
      expect(stillBound.statusCode).toBe(200);
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
      await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

      // accept the finding the skill's run produced (not some other test's finding)
      const [f] = await pg.handle.db
        .select({ id: t.findings.id })
        .from(t.findings)
        .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
        .where(eq(t.reviews.runId, run1!.id));
      await pg.handle.db.update(t.findings).set({ acceptedAt: new Date() }).where(eq(t.findings.id, f!.id));

      const stats = (await app.inject({ method: 'GET', url: `/skills/${a.id}/stats` })).json();
      expect(stats.pull_rate).toBe(0.5);
      expect(stats.used_by[0].enabled).toBe(false);
      expect(stats.findings_by_category).toEqual([{ category: 'security', count: 1 }]);
      expect(stats.accept_rate).toBe(1);

      const item = (await app.inject({ method: 'GET', url: '/skills' })).json().find((s: { id: string }) => s.id === a.id);
      expect(item).toMatchObject({ agent_count: 0, pull_rate: 0.5, accept_rate: 1 });
      await app.close();
    });
  });
});

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `skills-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 1,
      title: 'Add config',
      author: 'dev',
      branch: 'feat/x',
      base: 'main',
      headSha: `sha${repoSeq}`,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'x',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}
