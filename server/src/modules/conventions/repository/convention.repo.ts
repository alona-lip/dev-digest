import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { ConventionStatus } from '@devdigest/shared';
import type { Executor } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { ConventionRow } from '../../../db/rows.js';

export type { ConventionRow };

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  category: ConventionRow['category'];
  rule: string;
  evidencePath: string;
  evidenceStartLine: number;
  evidenceEndLine: number;
  evidenceSnippet: string;
  confidence: number;
}

export interface UpdateConventionRow {
  rule?: string;
  category?: ConventionRow['category'];
  status?: ConventionStatus;
}

/** `conventions` data-access. Workspace-scoped throughout. */
export class ConventionRepository {
  constructor(private db: Executor) {}

  /** Run `fn` in one transaction; on a Tx this nests as a savepoint. */
  inTransaction<T>(fn: (repo: ConventionRepository) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(new ConventionRepository(tx)));
  }

  /**
   * Serialise writers of one repo's candidates until the surrounding transaction
   * ends, so two overlapping scans can't both pass the dedupe and insert the same
   * rule. Must run inside `inTransaction`.
   */
  async lockRepo(repoId: string): Promise<void> {
    await this.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`conventions:${repoId}`}, 0))`);
  }

  /** Newest scan first; inside one scan, the most confident first. */
  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(desc(t.conventions.createdAt), desc(t.conventions.confidence));
  }

  async listAccepted(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, 'ACCEPTED'),
        ),
      )
      .orderBy(desc(t.conventions.createdAt), desc(t.conventions.confidence));
  }

  /** New candidates start ACCEPTED (column default). */
  async insertMany(rows: InsertConvention[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.insert(t.conventions).values(rows);
  }

  async update(
    workspaceId: string,
    id: string,
    fields: UpdateConventionRow,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  /** Ids outside the repo/workspace are ignored, not errors. */
  async setStatusMany(
    workspaceId: string,
    repoId: string,
    ids: string[],
    status: ConventionStatus,
  ): Promise<void> {
    await this.db
      .update(t.conventions)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          inArray(t.conventions.id, ids),
        ),
      );
  }
}
