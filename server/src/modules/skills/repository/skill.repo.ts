import { and, asc, desc, eq } from 'drizzle-orm';
import type { Executor } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { SkillRow, SkillVersionRow } from '../../../db/rows.js';

export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillRow['type'];
  source: SkillRow['source'];
  body: string;
  enabled: boolean;
}

export interface UpdateSkillRow {
  name?: string;
  description?: string;
  type?: SkillRow['type'];
  enabled?: boolean;
}

/** skills + skill_versions data-access. Workspace-scoped throughout. */
export class SkillRepository {
  constructor(private db: Executor) {}

  /** Run `fn` in one transaction; on a Tx this nests as a savepoint. */
  inTransaction<T>(fn: (repo: SkillRepository) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(new SkillRepository(tx)));
  }

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId))
      .orderBy(asc(t.skills.name));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Row lock: serialises concurrent edits so version numbers never collide. */
  async getByIdForUpdate(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .for('update');
    return row;
  }

  async findByName(workspaceId: string, name: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, name)));
    return row;
  }

  /** Insert at version 1 and snapshot it. */
  async insert(input: InsertSkill, note: string): Promise<SkillRow> {
    const [row] = await this.db.insert(t.skills).values({ ...input, version: 1 }).returning();
    await this.db
      .insert(t.skillVersions)
      .values({ skillId: row!.id, version: 1, body: input.body, message: note });
    return row!;
  }

  /** Non-body fields only — never bumps the version. */
  async updateFields(workspaceId: string, id: string, patch: UpdateSkillRow): Promise<SkillRow> {
    const [row] = await this.db
      .update(t.skills)
      .set(patch)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();
    return row!;
  }

  /** Write a new body as version `version` (caller holds the row lock) + snapshot it. */
  async writeBodyVersion(
    workspaceId: string,
    id: string,
    body: string,
    version: number,
    note: string,
  ): Promise<SkillRow> {
    const [row] = await this.db
      .update(t.skills)
      .set({ body, version })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();
    await this.db
      .insert(t.skillVersions)
      .values({ skillId: id, version, body, message: note });
    return row!;
  }

  /** Cascades to agent_skills, skill_versions and run_skills. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }
}
