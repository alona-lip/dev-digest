import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { DEFAULT_AGENT_DESCRIPTION, INITIAL_AGENT_VERSION } from './constants.js';
import { isConfigChange } from './helpers.js';

/**
 * A2 — agents data-access. Owns `agents`, `agent_versions`, and the
 * `agent_skills` link table (shared with A1's skills repository, but A2 owns the
 * agent side: link/reorder/list for an agent). Workspace-scoped throughout.
 */

import type { AgentRow, AgentVersionRow } from '../../db/rows.js';
export type { AgentRow, AgentVersionRow };

export interface InsertAgent {
  workspaceId: string;
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
  createdBy?: string | null;
}

export interface UpdateAgent {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
}

/** A skill linked to an agent (with its order), joined from agent_skills. */
export interface LinkedSkillRow {
  skill: typeof t.skills.$inferSelect;
  order: number;
  /** Enabled for this agent (the skill's own `enabled` is the global switch). */
  enabled: boolean;
}

/** An enabled skill as it goes into a run's prompt. */
export interface ActiveSkill {
  id: string;
  name: string;
  body: string;
  version: number;
}

export interface SkillLinkInput {
  skillId: string;
  enabled: boolean;
}

export class AgentsRepository {
  constructor(private db: Executor) {}

  /** Run `fn` in one transaction; on a Tx this nests as a savepoint. */
  inTransaction<T>(fn: (repo: AgentsRepository) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(new AgentsRepository(tx)));
  }

  async list(workspaceId: string): Promise<AgentRow[]> {
    return this.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
  }

  /**
   * agent id → number of skills enabled FOR that agent (`agent_skills.enabled`),
   * the same rule as a skill card's `agent_count`; the skill's global switch is
   * not applied. Agents without links are absent (caller treats that as 0).
   */
  async skillCounts(workspaceId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({
        agentId: t.agentSkills.agentId,
        n: sql<number>`count(*) filter (where ${t.agentSkills.enabled})`.mapWith(Number),
      })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(eq(t.agents.workspaceId, workspaceId))
      .groupBy(t.agentSkills.agentId);
    return new Map(rows.map((r) => [r.agentId, r.n]));
  }

  async listEnabled(workspaceId: string): Promise<AgentRow[]> {
    return this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)));
  }

  /**
   * Fetch several agents by id (explicit multi-agent run selection).
   *
   * No `enabled` filter — an explicitly picked agent runs even when disabled,
   * exactly like `getById`. Rows come back in DB order, NOT the requested
   * order, and ids that don't exist are simply absent; both are the caller's
   * to deal with. Never call this with an empty array: `inArray(col, [])` is
   * invalid SQL in Drizzle.
   */
  async listByIds(workspaceId: string, ids: string[]): Promise<AgentRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), inArray(t.agents.id, ids)));
  }

  async getById(workspaceId: string, id: string): Promise<AgentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)));
    return row;
  }

  /** Delete an agent (scoped to workspace). Versions/skill-links cascade;
   *  agent_runs keep their history with agent_id set null. Returns false if
   *  no such agent existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning({ id: t.agents.id });
    return rows.length > 0;
  }

  /**
   * Insert an agent AND record version 1 in agent_versions (immutable
   * snapshot) — one transaction, so an agent never exists without its v1.
   */
  insert(values: InsertAgent): Promise<AgentRow> {
    return this.inTransaction((repo) => repo.insertWithSnapshot(values));
  }

  private async insertWithSnapshot(values: InsertAgent): Promise<AgentRow> {
    const [row] = await this.db
      .insert(t.agents)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description ?? DEFAULT_AGENT_DESCRIPTION,
        provider: values.provider,
        model: values.model,
        systemPrompt: values.systemPrompt,
        outputSchema: (values.outputSchema as object | undefined) ?? null,
        ...(values.strategy !== undefined ? { strategy: values.strategy } : {}),
        ...(values.ciFailOn !== undefined ? { ciFailOn: values.ciFailOn } : {}),
        ...(values.repoIntel !== undefined ? { repoIntel: values.repoIntel } : {}),
        enabled: values.enabled ?? true,
        version: INITIAL_AGENT_VERSION,
        createdBy: values.createdBy ?? null,
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_AGENT_VERSION);
    return row!;
  }

  /**
   * Update an agent. Any config change bumps the version and snapshots the new
   * config into agent_versions (reproducibility for eval).
   *
   * One transaction with the agent row locked (`FOR UPDATE`): two concurrent
   * edits used to both read version N, both write N+1, and the second
   * snapshot was silently dropped by `onConflictDoNothing`. Now the second
   * waits, reads N+1 and writes N+2.
   */
  update(workspaceId: string, id: string, patch: UpdateAgent): Promise<AgentRow | undefined> {
    return this.inTransaction((repo) => repo.updateLocked(workspaceId, id, patch));
  }

  private async updateLocked(
    workspaceId: string,
    id: string,
    patch: UpdateAgent,
  ): Promise<AgentRow | undefined> {
    const [existing] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .for('update');
    if (!existing) return undefined;

    // A config-affecting change (anything except just toggling enabled) bumps version.
    const configChanged = isConfigChange(existing, patch);
    const nextVersion = configChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.agents)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
        ...(patch.outputSchema !== undefined
          ? { outputSchema: patch.outputSchema as object }
          : {}),
        ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
        ...(patch.ciFailOn !== undefined ? { ciFailOn: patch.ciFailOn } : {}),
        ...(patch.repoIntel !== undefined ? { repoIntel: patch.repoIntel } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(configChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning();

    if (configChanged && row) await this.snapshotVersion(row, nextVersion);
    return row;
  }

  private async snapshotVersion(row: AgentRow, version: number): Promise<void> {
    const skills = await this.skillIdsForAgent(row.id);
    await this.db
      .insert(t.agentVersions)
      .values({
        agentId: row.id,
        version,
        configJson: {
          provider: row.provider,
          model: row.model,
          system_prompt: row.systemPrompt,
          output_schema: row.outputSchema,
          strategy: row.strategy,
          ci_fail_on: row.ciFailOn,
          repo_intel: row.repoIntel,
          skills,
        },
      })
      .onConflictDoNothing();
  }

  // ---- agent_versions (immutable config snapshots) ------------------------

  /** All config snapshots for an agent, newest version first. */
  async listVersions(agentId: string): Promise<AgentVersionRow[]> {
    return this.db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agentId))
      .orderBy(desc(t.agentVersions.version));
  }

  /** A single config snapshot, or undefined if that version was never recorded. */
  async getVersion(agentId: string, version: number): Promise<AgentVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agentId), eq(t.agentVersions.version, version)));
    return row;
  }

  // ---- agent_skills link table (A2 owns the agent side) -------------------

  /** Skills linked to an agent, in `order` ascending. */
  async linkedSkills(agentId: string): Promise<LinkedSkillRow[]> {
    const rows = await this.db
      .select({ skill: t.skills, order: t.agentSkills.order, enabled: t.agentSkills.enabled })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));
    return rows.map((r) => ({ skill: r.skill, order: r.order, enabled: r.enabled }));
  }

  /**
   * Ids of the skills ACTIVE for this agent, in prompt order — what the version
   * snapshot records (a link switched off for the agent is not part of its config).
   */
  async skillIdsForAgent(agentId: string): Promise<string[]> {
    const links = await this.linkedSkills(agentId);
    return links.filter((l) => l.enabled && l.skill.enabled).map((l) => l.skill.id);
  }

  /** Skills for a run's prompt: bound + enabled for the agent + globally enabled, in order. */
  async activeSkillsForRun(agentId: string): Promise<ActiveSkill[]> {
    const links = await this.linkedSkills(agentId);
    return links
      .filter((l) => l.enabled && l.skill.enabled)
      .map((l) => ({
        id: l.skill.id,
        name: l.skill.name,
        body: l.skill.body,
        version: l.skill.version,
      }));
  }

  /** How many of `skillIds` exist in the workspace — tenancy guard for links. */
  async countWorkspaceSkills(workspaceId: string, skillIds: string[]): Promise<number> {
    if (skillIds.length === 0) return 0;
    const rows = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), inArray(t.skills.id, skillIds)));
    return rows.length;
  }

  /**
   * Replace the agent's whole skill list (order = array index) in ONE transaction
   * with the agent row locked. If the set of skills ACTIVE in the prompt (ids, in
   * order) changed, the agent's config version is bumped and snapshotted — otherwise
   * two runs "without / with skills" would carry the same version in their traces.
   * Returns undefined when the agent doesn't exist in the workspace.
   */
  replaceSkills(
    workspaceId: string,
    agentId: string,
    items: SkillLinkInput[],
  ): Promise<AgentRow | undefined> {
    return this.inTransaction(async (repo) => {
      const [agent] = await repo.db
        .select()
        .from(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)))
        .for('update');
      if (!agent) return undefined;

      const before = await repo.skillIdsForAgent(agentId);
      await repo.db.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
      if (items.length > 0) {
        await repo.db.insert(t.agentSkills).values(
          items.map((it, i) => ({ agentId, skillId: it.skillId, order: i, enabled: it.enabled })),
        );
      }
      const after = await repo.skillIdsForAgent(agentId);
      if (!sameIds(before, after)) {
        const version = agent.version + 1;
        const [row] = await repo.db
          .update(t.agents)
          .set({ version })
          .where(eq(t.agents.id, agentId))
          .returning();
        await repo.snapshotVersion(row!, version);
        return row!;
      }
      return agent;
    });
  }

  /** Link a skill to an agent at a given order (idempotent: upserts order). */
  async linkSkill(agentId: string, skillId: string, order: number): Promise<void> {
    await this.db
      .insert(t.agentSkills)
      .values({ agentId, skillId, order })
      .onConflictDoUpdate({
        target: [t.agentSkills.agentId, t.agentSkills.skillId],
        set: { order },
      });
  }

  async unlinkSkill(agentId: string, skillId: string): Promise<void> {
    await this.db
      .delete(t.agentSkills)
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.agentSkills.skillId, skillId)));
  }
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
