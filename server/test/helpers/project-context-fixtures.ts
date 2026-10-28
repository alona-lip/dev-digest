import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import * as t from '../../src/db/schema.js';
import type { PgFixture } from './pg.js';

/** Files of a fixture clone: repo-relative POSIX path -> text or raw bytes. */
export type CloneFiles = Record<string, string | Uint8Array>;

const made: string[] = [];

/** Create a temp dir populated with `files` (parent dirs created as needed). */
export async function makeClone(files: CloneFiles = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'devdigest-ctx-'));
  made.push(dir);
  await writeFiles(dir, files);
  return dir;
}

export async function writeFiles(dir: string, files: CloneFiles): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body);
  }
}

/** Remove every temp dir created through `makeClone` (call from `afterAll`). */
export async function cleanupClones(): Promise<void> {
  await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true })));
}

let repoSeq = 0;

/** Insert a repo row (optionally with a clone path) and, on request, a PR for it. */
export async function insertRepo(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  clonePath: string | null,
) {
  const name = `ctx-repo-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
    .returning();
  return repo!;
}

export async function insertPr(db: PgFixture['handle']['db'], workspaceId: string, repoId: string) {
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number: 1,
      title: 'Add config',
      author: 'dev',
      branch: 'feat/x',
      base: 'main',
      headSha: `sha-ctx-${repoSeq++}`,
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
  return pr!;
}
