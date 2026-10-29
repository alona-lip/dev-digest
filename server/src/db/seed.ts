import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import { BriefRecord } from '@devdigest/shared';
import { parseSkillMarkdown, scanSkillBody, toScanColumns } from '../modules/skills/helpers.js';
import { INITIAL_VERSION_NOTE } from '../modules/skills/constants.js';
import { SkillRepository } from '../modules/skills/repository/skill.repo.js';
import { AgentsRepository } from '../modules/agents/repository.js';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seeded diff of src/middleware/ratelimit.ts for PR #482: one hunk, 84 added lines
 * (matches its pr_files `additions`), so the demo brief's review focus points inside it.
 */
const RATELIMIT_PATCH = `@@ -0,0 +1,84 @@
+import type { FastifyReply, FastifyRequest } from 'fastify';
+import { RateLimitError } from '../platform/errors.js';
+
+/**
+ * Token-bucket rate limiter for the public API.
+ * One bucket per client key; refilled lazily on each request.
+ */
+export interface RateLimitOptions {
+  capacity: number;
+  refillPerSecond: number;
+}
+
+const clientKey = (req: FastifyRequest): string =>
+  String(req.headers['x-forwarded-for'] ?? req.ip);
+const trustProxyHeader = true;
+const FALLBACK_KEY = 'anonymous';
+
+export function resolveClientKey(req: FastifyRequest): string {
+  const raw = trustProxyHeader ? clientKey(req) : req.ip;
+  return raw.split(',')[0]?.trim() || FALLBACK_KEY;
+}
+
+interface Bucket {
+  tokens: number;
+  updatedAt: number;
+}
+
+const buckets = new Map<string, Bucket>();
+const WINDOW_SECONDS = 3600;
+const MAX_BUCKETS = 10_000;
+
+function refill(bucket: Bucket, opts: RateLimitOptions, now: number): void {
+  const elapsed = (now - bucket.updatedAt) / 1000;
+  bucket.tokens = Math.min(opts.capacity, bucket.tokens + elapsed * opts.refillPerSecond);
+  bucket.updatedAt = now;
+}
+
+function evictIfFull(): void {
+  if (buckets.size < MAX_BUCKETS) return;
+  const oldest = buckets.keys().next().value;
+  if (oldest !== undefined) buckets.delete(oldest);
+}
+
+export function tryConsume(key: string, opts: RateLimitOptions, now = Date.now()): boolean {
+  let bucket = buckets.get(key);
+  if (!bucket) {
+    evictIfFull();
+    bucket = { tokens: opts.capacity, updatedAt: now };
+    buckets.set(key, bucket);
+  }
+  refill(bucket, opts, now);
+  if (bucket.tokens < 1) return false;
+  bucket.tokens -= 1;
+  return true;
+}
+
+export function retryAfterSeconds(key: string, opts: RateLimitOptions): number {
+  const bucket = buckets.get(key);
+  if (!bucket) return 0;
+  const missing = 1 - bucket.tokens;
+  return Math.max(1, Math.ceil(missing / opts.refillPerSecond));
+}
+
+export function rateLimit(opts: RateLimitOptions) {
+  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
+    const key = resolveClientKey(req);
+    if (tryConsume(key, opts)) {
+      reply.header('x-ratelimit-limit', String(opts.capacity));
+      return;
+    }
+    const retryAfter = retryAfterSeconds(key, opts);
+    reply.header('retry-after', String(retryAfter));
+    throw new RateLimitError(\`Too many requests, retry in \${retryAfter}s\`);
+  };
+}
+
+export function resetBuckets(): void {
+  buckets.clear();
+}
+
+export const PUBLIC_API_LIMIT: RateLimitOptions = {
+  capacity: WINDOW_SECONDS / 36,
+  refillPerSecond: 1,
+};`;

/**
 * The example skills live as plain files, so the docs and the seed share one copy.
 * Resolved from the server/ package folder (the cwd of `pnpm db:seed` and of the
 * tests, like dotenv's .env), not from import.meta.url: seed.ts is also bundled
 * into dist/server.js, where a module-relative path points elsewhere.
 */
const SKILLS_DIR = resolve(process.cwd(), '../docs/skills-examples');

type SeedAgentName =
  | 'General Reviewer'
  | 'Security Reviewer'
  | 'Performance Reviewer'
  | 'Test Quality Reviewer'
  | 'API Contract Reviewer';

/** Skill files per built-in agent, in prompt order (docs/skills-examples/README.md). */
const SEED_AGENT_SKILLS = {
  'Test Quality Reviewer': [
    'test-quality/branch-coverage.md',
    'test-quality/corner-cases.md',
    'test-quality/test-smells/SKILL.md',
  ],
  'API Contract Reviewer': [
    'api-contract/breaking-change.md',
    'api-contract/response-schema.md',
    'api-contract/deprecation-policy.md',
    'api-contract/semver-discipline.md',
  ],
} satisfies Partial<Record<SeedAgentName, readonly string[]>>;

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the five built-in agents (General, Security,
 * Performance, Test Quality, API Contract), all on the default
 * openrouter/deepseek-v4-flash provider+model. Test Quality and API Contract
 * get the example skills from docs/skills-examples/, bound in prompt order.
 *
 * Course lessons populate the other tables (conventions, memory, eval, …)
 * once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      {
        prId: pr!.id,
        path: 'src/middleware/ratelimit.ts',
        additions: 84,
        deletions: 0,
        patch: RATELIMIT_PATCH,
      },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
      {
        reviewId: review!.id,
        file: 'src/middleware/ratelimit.ts',
        startLine: 28,
        endLine: 28,
        severity: 'SUGGESTION',
        category: 'style',
        title: 'Extract magic number 3600',
        rationale:
          'The number 3600 appears twice without explanation. A reader has to infer it means seconds-in-an-hour.',
        suggestion: 'Extract to a named constant, e.g. `const WINDOW_SECONDS = 3600`.',
        confidence: 0.62,
      },
    ]);

    // A generated PR brief fixture (SPEC-03) so the Overview shows one before the first
    // "Generate brief" click. head_sha equals the PR's head_sha, so it is not stale; the
    // model is 'seed/fixture' because no model produced this text. Focus lines sit inside
    // the seeded ratelimit.ts hunk (1-84).
    await db.insert(t.prBrief).values({
      prId: pr!.id,
      json: BriefRecord.parse({
        pr_id: pr!.id,
        head_sha: 'a1b2c3d4e5f6',
        generated_at: new Date().toISOString(),
        model: 'seed/fixture',
        summary:
          'Adds a token-bucket rate limiter in front of the public API endpoints, with per-client buckets and a new limit setting in the config. The main review questions are how the client key is derived and whether in-process state is enough.',
        risks: [
          {
            kind: 'security',
            title: 'Client key can be spoofed through x-forwarded-for',
            explanation:
              'The limiter keys buckets on the x-forwarded-for header whenever it is present, so a client can rotate the header value to get a fresh bucket on every request and bypass the limit.',
            severity: 'high',
            file_refs: ['src/middleware/ratelimit.ts:12-18'],
          },
          {
            kind: 'config',
            title: 'New limit settings live in the shared config',
            explanation:
              'The limiter capacity and refill rate are read from src/config.ts; a wrong value there changes throttling for every public endpoint at once.',
            severity: 'medium',
            file_refs: ['src/config.ts'],
          },
          {
            kind: 'performance',
            title: 'Per-client buckets are held in process memory',
            explanation:
              'Buckets are kept in an in-memory map with a size cap, so memory use grows with distinct clients and limits are not shared between server instances.',
            severity: 'low',
            file_refs: ['src/middleware/ratelimit.ts'],
          },
        ],
        review_focus: [
          {
            file: 'src/middleware/ratelimit.ts',
            line: 18,
            reason: 'Check how the client key is resolved and whether the forwarded header can be trusted here.',
          },
          {
            file: 'src/middleware/ratelimit.ts',
            line: 25,
            reason: 'Bucket state is per process; confirm that is acceptable if the API runs on more than one instance.',
          },
          {
            file: 'src/middleware/ratelimit.ts',
            line: 44,
            reason: 'Verify the refill and consume logic: tokens must never exceed capacity or go negative.',
          },
          {
            file: 'src/middleware/ratelimit.ts',
            line: 73,
            reason: 'Confirm the rejected request gets the right error and a correct retry-after value.',
          },
        ],
        missing_inputs: [],
        trimmed_inputs: [],
        dropped: { risks: 0, review_focus: 0 },
        input_tokens: 0,
        cost_usd: null,
      }),
    });
  }

  // ---- built-in agents (the starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert & { name: SeedAgentName }> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    // The two prompts below are deliberately generic: what makes them sharp is the
    // skills bound to them (SEED_AGENT_SKILLS, see docs/skills-experiment.md).
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description: 'Checks test quality: uncovered branches, missing corner cases, over-mocking, flakes.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'API Contract Reviewer',
      description: 'Detects breaking API changes: routes, payload shapes, exported signatures.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- built-in skills, bound to their agents ----
  for (const [agentName, files] of Object.entries(SEED_AGENT_SKILLS)) {
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, agentName)));
    if (!agent) continue;
    // Only an agent nobody has bound anything to: a re-seed must not undo an unbind,
    // nor add skills next to a set someone already curated.
    const [linked] = await db.select().from(t.agentSkills).where(eq(t.agentSkills.agentId, agent.id)).limit(1);
    if (linked) continue;

    const items: { skillId: string; enabled: boolean }[] = [];
    for (const file of files) items.push({ skillId: await seedSkill(db, workspaceId, file), enabled: true });
    // Through the repository so the agent's version is bumped and snapshotted, like a Skills-tab save.
    await new AgentsRepository(db).replaceSkills(workspaceId, agent.id, items);
  }

  return { workspaceId, userId };
}

/**
 * Create one example skill from its file the way an import would (same parser,
 * same scan, v1 snapshot), or reuse the existing skill of that name untouched.
 */
async function seedSkill(db: Db, workspaceId: string, file: string): Promise<string> {
  const parsed = parseSkillMarkdown(readFileSync(resolve(SKILLS_DIR, file), 'utf8'), file);
  const skills = new SkillRepository(db);
  const existing = await skills.findByName(workspaceId, parsed.name);
  if (existing) return existing.id;

  const scan = scanSkillBody(parsed.body);
  const row = await skills.inTransaction((repo) =>
    repo.insert(
      {
        workspaceId,
        name: parsed.name,
        description: parsed.description,
        type: parsed.type,
        source: 'imported_file',
        body: parsed.body,
        enabled: scan.status !== 'injection', // a flagged body is stored blocked, as on import
        ...toScanColumns(scan, new Date()),
      },
      INITIAL_VERSION_NOTE,
    ),
  );
  return row.id;
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
