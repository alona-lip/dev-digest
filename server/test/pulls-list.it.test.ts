/**
 * GET /repos/:id/pulls — the PR list's FINDINGS + SCORE columns across agents.
 * One Run Review click writes one review per agent, so FINDINGS must sum the
 * LATEST review of EACH agent (a re-run replaces that agent's previous result),
 * and SCORE is recomputed from exactly those findings (Field Manual, Sheet 05:
 * "the number can never contradict the list"). Reviews + findings are inserted
 * directly with explicit created_at so "latest" is deterministic; GitHub is a
 * mock that lists no PRs, so the route serves only the persisted rows.
 * See server/specs/pr-list-findings-by-agent.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { PrMeta } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

type Db = PgFixture['handle']['db'];

async function insertPr(db: Db, workspaceId: string, repoId: string, number: number) {
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number,
      title: `PR ${number}`,
      author: 'marisa.koch',
      branch: `feat/${number}`,
      base: 'main',
      headSha: `sha${number}`,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  return pr!;
}

async function insertAgent(db: Db, workspaceId: string, name: string) {
  const [agent] = await db
    .insert(t.agents)
    .values({ workspaceId, name, provider: 'openai', model: 'gpt-4.1', systemPrompt: name })
    .returning();
  return agent!;
}

async function insertReview(
  db: Db,
  args: {
    workspaceId: string;
    prId: string;
    agentId: string | null;
    score: number;
    createdAt: Date;
    severities: string[];
  },
) {
  const [review] = await db
    .insert(t.reviews)
    .values({
      workspaceId: args.workspaceId,
      prId: args.prId,
      agentId: args.agentId,
      kind: 'review',
      score: args.score,
      createdAt: args.createdAt,
    })
    .returning();
  if (args.severities.length > 0) {
    await db.insert(t.findings).values(
      args.severities.map((severity, i) => ({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: i + 1,
        endLine: i + 1,
        severity,
        category: 'bug',
        title: `${severity} #${i}`,
        rationale: 'r',
        confidence: 0.9,
      })),
    );
  }
  return review!;
}

d('GET /repos/:id/pulls — FINDINGS across agents (Testcontainers pg)', () => {
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
  });

  it("sums each agent's latest review, groups by agent, derives SCORE from those findings", async () => {
    const db = pg.handle.db;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'multi-agent', fullName: 'acme/multi-agent' })
      .returning();
    const pr = await insertPr(db, workspaceId, repo!.id, 900);
    const neverReviewed = await insertPr(db, workspaceId, repo!.id, 901);
    const clean = await insertPr(db, workspaceId, repo!.id, 902);

    const alpha = await insertAgent(db, workspaceId, 'Alpha Reviewer');
    const beta = await insertAgent(db, workspaceId, 'Beta Reviewer');
    const at = (min: number) => new Date(Date.UTC(2026, 8, 27, 12, min));

    // Alpha ran twice: the older run (3 CRITICAL) must be replaced, not added.
    await insertReview(db, {
      workspaceId, prId: pr.id, agentId: alpha.id, score: 10, createdAt: at(0),
      severities: ['CRITICAL', 'CRITICAL', 'CRITICAL'],
    });
    const alphaLatest = await insertReview(db, {
      workspaceId, prId: pr.id, agentId: alpha.id, score: 88, createdAt: at(10),
      severities: ['WARNING'],
    });
    // Beta finished last — under the old "newest review overall" rule its 62
    // would have been the PR's SCORE.
    const betaLatest = await insertReview(db, {
      workspaceId, prId: pr.id, agentId: beta.id, score: 62, createdAt: at(20),
      severities: ['CRITICAL', 'SUGGESTION'],
    });
    // A legacy review with no agent recorded → its own "unknown" group, zero findings.
    const legacy = await insertReview(db, {
      workspaceId, prId: pr.id, agentId: null, score: 100, createdAt: at(5),
      severities: [],
    });
    // Reviewed, zero findings → SCORE 100, pills {0,0,0}.
    await insertReview(db, {
      workspaceId, prId: clean.id, agentId: beta.id, score: 100, createdAt: at(30),
      severities: [],
    });

    const app = await buildApp({
      config: config(),
      db,
      overrides: { github: new MockGitHubClient({ pulls: [] }) },
    });
    const res = await app.inject({ method: 'GET', url: `/repos/${repo!.id}/pulls` });
    expect(res.statusCode).toBe(200);
    const list = res.json() as PrMeta[];
    const row = list.find((p) => p.number === 900)!;

    // 1 C + 1 W + 1 S ⇒ 100 − 35 − 12 − 3 = 50 — the Sheet 05 worked example.
    expect(row.findings_by_severity).toEqual({ CRITICAL: 1, WARNING: 1, SUGGESTION: 1 });
    expect(row.score).toBe(50);

    const groups = row.findings_by_agent!;
    expect(groups.map((g) => [g.agent_name, g.review_id])).toEqual([
      ['Alpha Reviewer', alphaLatest.id],
      ['Beta Reviewer', betaLatest.id],
      [null, legacy.id],
    ]);
    expect(groups.map((g) => g.score)).toEqual([88, 62, 100]);
    expect(groups[0]!.findings_by_severity).toEqual({ CRITICAL: 0, WARNING: 1, SUGGESTION: 0 });
    expect(groups[1]!.findings.map((f) => f.severity)).toEqual(['CRITICAL', 'SUGGESTION']);
    expect(groups[2]!.agent_id).toBeNull();
    expect(groups[2]!.findings).toEqual([]);

    const untouched = list.find((p) => p.number === neverReviewed.number)!;
    expect(untouched.score ?? null).toBeNull();
    expect(untouched.findings_by_severity ?? null).toBeNull();
    expect(untouched.findings_by_agent ?? null).toBeNull();

    const cleanRow = list.find((p) => p.number === clean.number)!;
    expect(cleanRow.score).toBe(100);
    expect(cleanRow.findings_by_severity).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });

    await app.close();
  });
});
