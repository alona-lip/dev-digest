import { and, asc, count, countDistinct, desc, eq, gte, sql } from 'drizzle-orm';
import type { Executor } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import { STATS_WINDOW_DAYS } from '../constants.js';

export interface SkillRollup {
  agentCount: number;
  runs: number;
  runsWithSkill: number;
  accepted: number;
  dismissed: number;
}

export interface SkillStatsRaw extends SkillRollup {
  usedBy: { agentId: string; name: string; enabled: boolean }[];
  findingsByCategory: { category: string; count: number }[];
}

const EMPTY: SkillRollup = { agentCount: 0, runs: 0, runsWithSkill: 0, accepted: 0, dismissed: 0 };

/** Start of the rolling Stats window. */
function windowStart(): Date {
  return new Date(Date.now() - STATS_WINDOW_DAYS * 86_400_000);
}

/**
 * Skill rollups (list cards + Stats tab). Everything is derived from
 * `run_skills` — which skills were in the prompt of which run — joined to the
 * run's findings. These are correlations, not causal effects.
 *
 * Queries touch tables other modules own (agents, runs, reviews, findings), so they
 * go through the typed Drizzle schema, never raw SQL strings: renaming a column there
 * fails `tsc` here instead of failing at runtime (`arch:check` only sees imports).
 *
 * One grouped query per metric, never one per skill.
 */
export class SkillStatsRepository {
  constructor(private db: Executor) {}

  /** Rollups for every skill of the workspace (or one, with `skillId`). */
  async rollups(workspaceId: string, skillId?: string): Promise<Map<string, SkillRollup>> {
    const since = windowStart();
    const out = new Map<string, SkillRollup>();
    const slot = (id: string): SkillRollup => {
      let r = out.get(id);
      if (!r) out.set(id, (r = { ...EMPTY }));
      return r;
    };

    // Agents the skill is enabled for.
    const agents = await this.db
      .select({
        skillId: t.agentSkills.skillId,
        n: sql<number>`count(*) filter (where ${t.agentSkills.enabled})`.mapWith(Number),
      })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.skills.id, t.agentSkills.skillId))
      .where(and(eq(t.skills.workspaceId, workspaceId), skillId ? eq(t.agentSkills.skillId, skillId) : undefined))
      .groupBy(t.agentSkills.skillId);
    for (const r of agents) slot(r.skillId).agentCount = r.n;

    // Runs of agents the skill is bound to, and how many had it in the prompt.
    const pull = await this.db
      .select({
        skillId: t.agentSkills.skillId,
        total: countDistinct(t.agentRuns.id).mapWith(Number),
        withSkill: countDistinct(t.runSkills.runId).mapWith(Number),
      })
      .from(t.agentSkills)
      .innerJoin(
        t.skills,
        and(eq(t.skills.id, t.agentSkills.skillId), eq(t.skills.workspaceId, workspaceId)),
      )
      .innerJoin(
        t.agentRuns,
        and(
          eq(t.agentRuns.agentId, t.agentSkills.agentId),
          eq(t.agentRuns.status, 'done'),
          gte(t.agentRuns.ranAt, since),
        ),
      )
      .leftJoin(
        t.runSkills,
        and(eq(t.runSkills.runId, t.agentRuns.id), eq(t.runSkills.skillId, t.agentSkills.skillId)),
      )
      .where(skillId ? eq(t.agentSkills.skillId, skillId) : undefined)
      .groupBy(t.agentSkills.skillId);
    for (const r of pull) {
      const s = slot(r.skillId);
      s.runs = r.total;
      s.runsWithSkill = r.withSkill;
    }

    // What happened to the findings of the runs the skill was in.
    const accept = await this.db
      .select({
        skillId: t.runSkills.skillId,
        accepted: count(t.findings.acceptedAt).mapWith(Number),
        dismissed: count(t.findings.dismissedAt).mapWith(Number),
      })
      .from(t.runSkills)
      .innerJoin(
        t.skills,
        and(eq(t.skills.id, t.runSkills.skillId), eq(t.skills.workspaceId, workspaceId)),
      )
      .innerJoin(t.agentRuns, and(eq(t.agentRuns.id, t.runSkills.runId), gte(t.agentRuns.ranAt, since)))
      .innerJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
      .innerJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
      .where(skillId ? eq(t.runSkills.skillId, skillId) : undefined)
      .groupBy(t.runSkills.skillId);
    for (const r of accept) {
      const s = slot(r.skillId);
      s.accepted = r.accepted;
      s.dismissed = r.dismissed;
    }
    return out;
  }

  async statsFor(workspaceId: string, skillId: string): Promise<SkillStatsRaw> {
    const rollup = (await this.rollups(workspaceId, skillId)).get(skillId) ?? { ...EMPTY };

    const used = await this.db
      .select({ agentId: t.agents.id, name: t.agents.name, enabled: t.agentSkills.enabled })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(and(eq(t.agentSkills.skillId, skillId), eq(t.agents.workspaceId, workspaceId)))
      .orderBy(asc(t.agents.name));

    const n = count();
    const cats = await this.db
      .select({ category: t.findings.category, n: n.mapWith(Number) })
      .from(t.runSkills)
      .innerJoin(
        t.agentRuns,
        and(
          eq(t.agentRuns.id, t.runSkills.runId),
          eq(t.agentRuns.workspaceId, workspaceId),
          gte(t.agentRuns.ranAt, windowStart()),
        ),
      )
      .innerJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
      .innerJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
      .where(eq(t.runSkills.skillId, skillId))
      .groupBy(t.findings.category)
      .orderBy(desc(n), asc(t.findings.category));

    return {
      ...rollup,
      usedBy: used,
      findingsByCategory: cats.map((r) => ({ category: r.category, count: r.n })),
    };
  }
}
