import type { AgentSkillLink, SkillListItem } from "@devdigest/shared";

/** One line of the tab: a library skill + this agent's binding to it. */
export interface SkillRow {
  skill: SkillListItem;
  /** Has a binding to this agent (a row is only persisted when bound). */
  bound: boolean;
  /** The checkbox: enabled for THIS agent. */
  enabled: boolean;
}

/**
 * Bound skills first, in the agent's order (that order IS the prompt order),
 * then every other library skill by name. Skills not bound yet show unchecked.
 */
export function mergeSkillRows(skills: SkillListItem[], links: AgentSkillLink[]): SkillRow[] {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const bound: SkillRow[] = [...links]
    .sort((a, b) => a.order - b.order)
    .flatMap((l) => {
      const skill = byId.get(l.skill_id);
      return skill ? [{ skill, bound: true, enabled: l.enabled }] : [];
    });
  const boundIds = new Set(bound.map((r) => r.skill.id));
  const rest: SkillRow[] = skills
    .filter((s) => !boundIds.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((skill) => ({ skill, bound: false, enabled: false }));
  return [...bound, ...rest];
}

/**
 * Flip a checkbox. An unbound skill becomes bound + enabled and joins the END of
 * the bound block (so the list order matches what the server will return).
 */
export function toggleRow(rows: SkillRow[], skillId: string): SkillRow[] {
  const i = rows.findIndex((r) => r.skill.id === skillId);
  if (i < 0) return rows;
  const row = rows[i]!;
  if (row.bound) return rows.map((r, k) => (k === i ? { ...r, enabled: !r.enabled } : r));
  const without = rows.filter((_, k) => k !== i);
  const lastBound = without.map((r) => r.bound).lastIndexOf(true);
  const next = [...without];
  next.splice(lastBound + 1, 0, { ...row, bound: true, enabled: true });
  return next;
}

/** Move a BOUND row to `to` (index within the bound block). Unbound rows can't be ordered. */
export function moveRow(rows: SkillRow[], from: number, to: number): SkillRow[] {
  const boundCount = rows.filter((r) => r.bound).length;
  if (from < 0 || from >= boundCount || to < 0 || to >= boundCount || from === to) return rows;
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** The request body: bound rows only, in order. */
export function toPayload(rows: SkillRow[]): { skill_id: string; enabled: boolean }[] {
  return rows.filter((r) => r.bound).map((r) => ({ skill_id: r.skill.id, enabled: r.enabled }));
}

export function countEnabled(rows: SkillRow[]): number {
  return rows.filter((r) => r.enabled && r.skill.enabled).length;
}

export function filterRows(rows: SkillRow[], query: string): SkillRow[] {
  const q = query.trim().toLowerCase();
  return q ? rows.filter((r) => r.skill.name.toLowerCase().includes(q)) : rows;
}
