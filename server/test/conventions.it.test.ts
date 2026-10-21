import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/index.js';
import type { ConventionExtraction } from '../src/modules/conventions/schema.js';
import type {
  AgentSkillLink,
  ConventionCandidate,
  ConventionSkillDraft,
  ExtractConventionsResult,
  Skill,
} from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[conventions] Docker not available — skipping integration tests.');

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const USERS_TS = [
  "import { db } from '../db';",
  '',
  'export async function getUser(id: string) {',
  '  const user = await db.users.find(id);',
  '  const posts = await db.posts.findMany({ userId: id });',
  '  return { user, posts };',
  '}',
].join('\n');

/** The clone, as repo-intel would read it. */
const FILES: Record<string, string> = {
  'package.json': '{\n  "name": "payments-api",\n  "type": "module"\n}',
  'src/api/users.ts': USERS_TS,
};

const ASYNC_RULE = {
  rule: 'Always use async/await instead of .then() chains',
  category: 'ASYNC' as const,
  confidence: 0.91,
  evidence: {
    path: 'src/api/users.ts',
    start_line: 4,
    end_line: 5,
    snippet: 'const user = await db.users.find(id);\nconst posts = await db.posts.findMany({ userId: id });',
  },
};
const ESM_RULE = {
  rule: 'The package is ESM-only ("type": "module")',
  category: 'STRUCTURE' as const,
  confidence: 0.8,
  evidence: { path: 'package.json', start_line: 3, end_line: 3, snippet: '"type": "module"' },
};
const INVENTED_SNIPPET = {
  rule: 'Errors are wrapped in AppError',
  category: 'ERROR_HANDLING' as const,
  confidence: 0.7,
  evidence: { path: 'src/api/users.ts', start_line: 6, end_line: 6, snippet: 'throw new AppError("not found");' },
};
const UNSAMPLED_FILE = {
  rule: 'Redis goes through the singleton',
  category: 'STRUCTURE' as const,
  confidence: 0.85,
  evidence: { path: 'src/lib/redis.ts', start_line: 1, end_line: 1, snippet: 'export const redis = new Redis(url);' },
};

const mockRepoIntel = {
  getConventionSamples: async () => ['src/api/users.ts'],
  readRepoFile: async (_repoId: string, path: string) => FILES[path] ?? null,
} as unknown as RepoIntel;

d('conventions module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let generalId: string;
  let securityId: string;
  let llm: MockLLMProvider;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [repo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
    repoId = repo!.id;
    const agents = await pg.handle.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
    generalId = agents.find((a) => a.name === 'General Reviewer')!.id;
    securityId = agents.find((a) => a.name === 'Security Reviewer')!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(extraction: ConventionExtraction = { conventions: [] }) {
    llm = new MockLLMProvider('openai', { structuredBySchema: { ConventionExtraction: extraction } });
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: { openai: llm },
        repoIntel: mockRepoIntel,
      },
    });
  }

  const setClone = (clonePath: string | null) =>
    pg.handle.db.update(t.repos).set({ clonePath }).where(eq(t.repos.id, repoId));

  it('404s an unknown repo', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/repos/00000000-0000-4000-8000-000000000000/conventions' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('422s a scan of a repo that is not cloned, before any model call', async () => {
    await setClone(null);
    const app = await makeApp({ conventions: [ASYNC_RULE] });
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(res.statusCode).toBe(422);
    expect(llm.calls).toHaveLength(0);
    await app.close();
  });

  it('scans: samples configs + ranked files, calls the Conventions model once, drops ungrounded candidates, persists the rest', async () => {
    await setClone('/clones/acme/payments-api');
    const app = await makeApp({ conventions: [ASYNC_RULE, INVENTED_SNIPPET, UNSAMPLED_FILE] });
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(res.statusCode).toBe(200);
    const body = res.json<ExtractConventionsResult>();

    expect(body.stats).toEqual({ sampled_files: 2, proposed: 3, dropped_ungrounded: 2, dropped_duplicate: 0 });
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({
      rule: ASYNC_RULE.rule,
      category: 'ASYNC',
      status: 'PENDING',
      evidence_path: 'src/api/users.ts',
      evidence_start_line: 4,
      evidence_end_line: 5,
    });

    // One call, the sampled files delimiter-wrapped with a line gutter.
    const calls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(calls).toHaveLength(1);
    const req = calls[0]!.req as { schemaName: string; messages: { role: string; content: string }[] };
    expect(req.schemaName).toBe('ConventionExtraction');
    const user = req.messages.find((m) => m.role === 'user')!.content;
    expect(user).toContain('<untrusted source="repo-files">');
    expect(user).toContain('=== FILE: package.json ===');
    expect(user).toContain('4 |   const user = await db.users.find(id);');

    // Persisted: survives a fresh read.
    const list = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    expect(list.json<ConventionCandidate[]>().map((c) => c.rule)).toEqual([ASYNC_RULE.rule]);

    // Nothing accepted yet → no skill to draft.
    expect((await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions/skill-draft` })).statusCode).toBe(422);
    await app.close();
  });

  it('a rejected rule leaves the list and stays out: re-scan does not bring it back', async () => {
    const app = await makeApp({ conventions: [ASYNC_RULE, ESM_RULE] });
    const [asyncRow] = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json<
      ConventionCandidate[]
    >();
    const rej = await app.inject({
      method: 'PATCH',
      url: `/conventions/${asyncRow!.id}`,
      payload: { status: 'REJECTED' },
    });
    expect(rej.json<ConventionCandidate>().status).toBe('REJECTED');

    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const body = res.json<ExtractConventionsResult>();
    expect(body.stats.dropped_duplicate).toBe(1);
    const byRule = Object.fromEntries(body.candidates.map((c) => [c.rule, c.status]));
    expect(byRule).toEqual({ [ESM_RULE.rule]: 'PENDING' });

    // A reload does not return it either; the row is still there, as REJECTED.
    const list = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json<ConventionCandidate[]>();
    expect(list.map((c) => c.rule)).toEqual([ESM_RULE.rule]);
    const [stored] = await pg.handle.db.select().from(t.conventions).where(eq(t.conventions.id, asyncRow!.id));
    expect(stored?.status).toBe('REJECTED');
    await app.close();
  });

  it('edits a candidate inline and keeps the edit through a re-scan', async () => {
    const app = await makeApp({ conventions: [ESM_RULE] });
    const list = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json<ConventionCandidate[]>();
    const esm = list.find((c) => c.rule === ESM_RULE.rule)!;
    const res = await app.inject({
      method: 'PATCH',
      url: `/conventions/${esm.id}`,
      payload: { rule: 'Ship ESM only', category: 'STYLE' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<ConventionCandidate>()).toMatchObject({ rule: 'Ship ESM only', category: 'STYLE', status: 'PENDING' });

    const empty = await app.inject({ method: 'PATCH', url: `/conventions/${esm.id}`, payload: {} });
    expect(empty.statusCode).toBe(422);
    const unknown = await app.inject({
      method: 'PATCH',
      url: '/conventions/00000000-0000-4000-8000-000000000000',
      payload: { status: 'REJECTED' },
    });
    expect(unknown.statusCode).toBe(404);
    await app.close();
  });

  it('"Deselect all" rejects in bulk; the draft then refuses with nothing accepted', async () => {
    const app = await makeApp();
    const list = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json<ConventionCandidate[]>();
    const res = await app.inject({
      method: 'PATCH',
      url: `/repos/${repoId}/conventions`,
      payload: { ids: list.map((c) => c.id), status: 'REJECTED' },
    });
    expect(res.json<ConventionCandidate[]>()).toEqual([]);

    expect((await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions/skill-draft` })).statusCode).toBe(422);
    const save = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill`,
      payload: { name: 'repo-conventions', description: 'Use when x.', type: 'convention', body: 'b', agent_id: generalId },
    });
    expect(save.statusCode).toBe(422);

    // Accept the edited ESM rule for the skill tests below.
    const esm = list.find((c) => c.rule === 'Ship ESM only')!;
    await app.inject({ method: 'PATCH', url: `/conventions/${esm.id}`, payload: { status: 'ACCEPTED' } });
    await app.close();
  });

  it('drafts repo-conventions from ACCEPTED rules only', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions/skill-draft` });
    expect(res.statusCode).toBe(200);
    const draft = res.json<ConventionSkillDraft>();
    expect(draft).toMatchObject({ name: 'repo-conventions', type: 'convention', accepted_count: 1, existing_skill: null });
    expect(draft.body).toContain('## Ship ESM only');
    expect(draft.body).not.toContain(ASYNC_RULE.rule);
    await app.close();
  });

  it('saves the skill as v1 linked to the agent, then a second save writes v2 without a duplicate link', async () => {
    const app = await makeApp();
    const draft = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions/skill-draft` })).json<
      ConventionSkillDraft
    >();
    const payload = {
      name: draft.name,
      description: draft.description,
      type: draft.type,
      enabled: true,
      body: draft.body,
      agent_id: generalId,
    };

    const first = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/skill`, payload });
    expect(first.statusCode).toBe(201);
    const v1 = first.json<Skill>();
    expect(v1).toMatchObject({ name: 'repo-conventions', version: 1, source: 'extracted', type: 'convention' });

    const links = (await app.inject({ method: 'GET', url: `/agents/${generalId}/skills` })).json<AgentSkillLink[]>();
    expect(links.filter((l) => l.skill_id === v1.id)).toHaveLength(1);

    const again = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions/skill-draft` })).json<
      ConventionSkillDraft
    >();
    expect(again.existing_skill).toEqual({ id: v1.id, version: 1 });

    const second = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill`,
      payload: { ...payload, body: `${draft.body}\nEdited.\n` },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json<Skill>()).toMatchObject({ id: v1.id, version: 2 });
    const after = (await app.inject({ method: 'GET', url: `/agents/${generalId}/skills` })).json<AgentSkillLink[]>();
    expect(after.filter((l) => l.skill_id === v1.id)).toHaveLength(1);

    // Additive: linking to a second agent leaves its existing links alone.
    const before = (await app.inject({ method: 'GET', url: `/agents/${securityId}/skills` })).json<AgentSkillLink[]>();
    await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/skill`, payload: { ...payload, agent_id: securityId } });
    const sec = (await app.inject({ method: 'GET', url: `/agents/${securityId}/skills` })).json<AgentSkillLink[]>();
    expect(sec).toHaveLength(before.length + 1);
    await app.close();
  });

  it('two overlapping scans insert a new rule once (the read-dedupe-insert is serialised per repo)', async () => {
    const RETURN_SHAPE = {
      rule: 'Handlers return a plain { user, posts } object',
      category: 'STYLE' as const,
      confidence: 0.6,
      evidence: { path: 'src/api/users.ts', start_line: 6, end_line: 6, snippet: 'return { user, posts };' },
    };
    const app = await makeApp({ conventions: [RETURN_SHAPE] });
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` }),
      app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    const dups = [a, b].map((r) => r.json<ExtractConventionsResult>().stats.dropped_duplicate).sort();
    expect(dups).toEqual([0, 1]);
    const list = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json<ConventionCandidate[]>();
    expect(list.filter((c) => c.rule === RETURN_SHAPE.rule)).toHaveLength(1);
    await app.close();
  });

  it('404s an agent outside the workspace', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill`,
      payload: {
        name: 'repo-conventions',
        description: 'Use when x.',
        type: 'convention',
        body: 'b',
        agent_id: '00000000-0000-4000-8000-000000000000',
      },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
