import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../../../db/client.js';
import * as t from '../../../db/schema.js';

export type AttachmentKind = 'agent' | 'skill';

export interface RepoAttachments {
  agent: { agent_id: string; path: string }[];
  skill: { skill_id: string; path: string }[];
}

export interface RunAttachments {
  agentPaths: string[];
  /** skill id → its ordered paths (every requested id has an entry). */
  skillPaths: Map<string, string[]>;
}

/** Ordered attachment paths of one owner (agent or skill) in one repo. */
export async function listPaths(
  db: Executor,
  kind: AttachmentKind,
  ownerId: string,
  repoId: string,
): Promise<string[]> {
  if (kind === 'agent') {
    const rows = await db
      .select({ path: t.agentContextDocs.path })
      .from(t.agentContextDocs)
      .where(and(eq(t.agentContextDocs.agentId, ownerId), eq(t.agentContextDocs.repoId, repoId)))
      .orderBy(asc(t.agentContextDocs.position));
    return rows.map((r) => r.path);
  }
  const rows = await db
    .select({ path: t.skillContextDocs.path })
    .from(t.skillContextDocs)
    .where(and(eq(t.skillContextDocs.skillId, ownerId), eq(t.skillContextDocs.repoId, repoId)))
    .orderBy(asc(t.skillContextDocs.position));
  return rows.map((r) => r.path);
}

/**
 * Replace the whole path list for (owner, repo) in one transaction: delete then
 * multi-row insert with position = index. Empty list = delete only. Never touches
 * agents.version / agent_versions / skill_versions (AC-39).
 */
export async function replacePaths(
  db: Executor,
  kind: AttachmentKind,
  workspaceId: string,
  ownerId: string,
  repoId: string,
  paths: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    // Serialize concurrent replacements for the same (owner, repo): a transaction-scoped
    // advisory lock (released at commit/rollback), like replaceSkills locks the agent row.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${kind}:${ownerId}:${repoId}`}, 0))`);
    if (kind === 'agent') {
      await tx
        .delete(t.agentContextDocs)
        .where(and(eq(t.agentContextDocs.agentId, ownerId), eq(t.agentContextDocs.repoId, repoId)));
      if (paths.length === 0) return;
      await tx
        .insert(t.agentContextDocs)
        .values(paths.map((path, position) => ({ workspaceId, agentId: ownerId, repoId, path, position })));
      return;
    }
    await tx
      .delete(t.skillContextDocs)
      .where(and(eq(t.skillContextDocs.skillId, ownerId), eq(t.skillContextDocs.repoId, repoId)));
    if (paths.length === 0) return;
    await tx
      .insert(t.skillContextDocs)
      .values(paths.map((path, position) => ({ workspaceId, skillId: ownerId, repoId, path, position })));
  });
}

/** Every attachment in a repo, grouped by owner kind (for the repo-wide view). */
export async function listForRepo(db: Executor, repoId: string): Promise<RepoAttachments> {
  const [agent, skill] = await Promise.all([
    db
      .select({ agent_id: t.agentContextDocs.agentId, path: t.agentContextDocs.path })
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.repoId, repoId))
      .orderBy(asc(t.agentContextDocs.agentId), asc(t.agentContextDocs.position)),
    db
      .select({ skill_id: t.skillContextDocs.skillId, path: t.skillContextDocs.path })
      .from(t.skillContextDocs)
      .where(eq(t.skillContextDocs.repoId, repoId))
      .orderBy(asc(t.skillContextDocs.skillId), asc(t.skillContextDocs.position)),
  ]);
  return { agent, skill };
}

/** Ordered paths for a review run: the agent's own plus each enabled skill's. */
export async function listForRun(
  db: Executor,
  agentId: string,
  skillIds: string[],
  repoId: string,
): Promise<RunAttachments> {
  const agentPaths = await listPaths(db, 'agent', agentId, repoId);
  const skillPaths = new Map<string, string[]>(skillIds.map((id) => [id, []]));
  if (skillIds.length > 0) {
    const rows = await db
      .select({ skillId: t.skillContextDocs.skillId, path: t.skillContextDocs.path })
      .from(t.skillContextDocs)
      .where(and(inArray(t.skillContextDocs.skillId, skillIds), eq(t.skillContextDocs.repoId, repoId)))
      .orderBy(asc(t.skillContextDocs.position));
    for (const r of rows) skillPaths.get(r.skillId)?.push(r.path);
  }
  return { agentPaths, skillPaths };
}

/** True when the agent/skill exists in the workspace (tenancy check). */
export async function ownerInWorkspace(
  db: Executor,
  kind: AttachmentKind,
  workspaceId: string,
  ownerId: string,
): Promise<boolean> {
  if (kind === 'agent') {
    const rows = await db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.id, ownerId), eq(t.agents.workspaceId, workspaceId)))
      .limit(1);
    return rows.length > 0;
  }
  const rows = await db
    .select({ id: t.skills.id })
    .from(t.skills)
    .where(and(eq(t.skills.id, ownerId), eq(t.skills.workspaceId, workspaceId)))
    .limit(1);
  return rows.length > 0;
}

export async function agentIdsInWorkspace(db: Executor, workspaceId: string): Promise<string[]> {
  const rows = await db.select({ id: t.agents.id }).from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
  return rows.map((r) => r.id);
}
