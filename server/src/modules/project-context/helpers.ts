import type { ContextAttachmentDoc, ContextDocType, ContextUsage, SpecBlock } from '@devdigest/shared';
import { DEFAULT_DOC_TYPE, DOC_BUCKETS, CONTEXT_MAX_FILE_BYTES, INSIGHTS_FILE_NAME } from './constants.js';

/** Pure helpers for project context (ring 1: no I/O, contracts only). */

type Origin = SpecBlock['origin'];

function isBucket(seg: string): seg is (typeof DOC_BUCKETS)[number] {
  return (DOC_BUCKETS as readonly string[]).includes(seg);
}

/**
 * 'insights' for an INSIGHTS.md file name (any case); otherwise the deepest
 * *directory* segment in DOC_BUCKETS (case-insensitive), else 'docs'.
 */
export function docTypeOf(path: string): ContextDocType {
  const parts = path.split('/');
  if (parts[parts.length - 1]?.toLowerCase() === INSIGHTS_FILE_NAME) return 'insights';
  const dirs = parts.slice(0, -1);
  for (let i = dirs.length - 1; i >= 0; i--) {
    const seg = dirs[i]?.toLowerCase();
    if (seg !== undefined && isBucket(seg)) return seg;
  }
  return DEFAULT_DOC_TYPE;
}

/** Sorted by path; first `limit` items; `truncated` when more matched. */
export function toListPage<T extends { path: string }>(
  stats: readonly T[],
  limit: number,
): { items: T[]; truncated: boolean } {
  const sorted = [...stats].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { items: sorted.slice(0, limit), truncated: sorted.length > limit };
}

export interface EffectiveItem {
  path: string;
  origin: Origin;
}

/** Agent's paths first, then each skill's in the given order; dedupe by full path, first wins. */
export function buildEffectiveSet(
  agentPaths: readonly string[],
  skills: readonly { skill_id: string; name: string; paths: readonly string[] }[],
): EffectiveItem[] {
  const seen = new Set<string>();
  const out: EffectiveItem[] = [];
  const add = (path: string, origin: Origin) => {
    if (seen.has(path)) return;
    seen.add(path);
    out.push({ path, origin });
  };
  for (const p of agentPaths) add(p, { kind: 'agent' });
  for (const s of skills) {
    for (const p of s.paths) add(p, { kind: 'skill', skill_id: s.skill_id, name: s.name });
  }
  return out;
}

export interface BudgetInput {
  path: string;
  tokens: number | null;
  over1mb?: boolean;
}

export interface BudgetResult {
  path: string;
  status: 'attached' | 'over_budget';
}

/** Greedy: null-token / >1 MB items are over_budget without consuming budget. */
export function applyBudget(items: readonly BudgetInput[], budget: number): BudgetResult[] {
  let sum = 0;
  return items.map((it) => {
    if (it.tokens === null || it.over1mb) return { path: it.path, status: 'over_budget' as const };
    if (sum + it.tokens <= budget) {
      sum += it.tokens;
      return { path: it.path, status: 'attached' as const };
    }
    return { path: it.path, status: 'over_budget' as const };
  });
}

/**
 * Per-path usage counts. An agent counts a path if it is in its own list OR in
 * an active skill's list (once per agent); a skill counts only direct attachments.
 */
export function countUsage(
  agentAttachments: readonly { agent_id: string; paths: readonly string[] }[],
  skillAttachments: readonly { skill_id: string; paths: readonly string[] }[],
  activeSkillIdsByAgent: ReadonlyMap<string, readonly string[]>,
): ContextUsage['by_path'] {
  const byPath: ContextUsage['by_path'] = {};
  const bump = (path: string, key: 'agents' | 'skills') => {
    const e = (byPath[path] ??= { agents: 0, skills: 0 });
    e[key] += 1;
  };
  const skillPaths = new Map<string, readonly string[]>();
  for (const s of skillAttachments) {
    skillPaths.set(s.skill_id, s.paths);
    for (const p of new Set(s.paths)) bump(p, 'skills');
  }
  const activeFor = (agentId: string): readonly string[] =>
    activeSkillIdsByAgent.get(agentId) ?? [];
  for (const a of agentAttachments) {
    const paths = new Set(a.paths);
    for (const sid of activeFor(a.agent_id)) for (const p of skillPaths.get(sid) ?? []) paths.add(p);
    for (const p of paths) bump(p, 'agents');
  }
  return byPath;
}

/** Attachment paths -> contract docs, in the same order; `missing` when absent from the full set. */
export function toAttachmentDocs(
  paths: readonly string[],
  fullSetByPath: ReadonlyMap<string, { type: ContextDocType; size_bytes: number }>,
  tokensByPath: ReadonlyMap<string, number | null>,
): ContextAttachmentDoc[] {
  return paths.map((path) => {
    const meta = fullSetByPath.get(path);
    if (!meta) return { path, type: null, tokens: null, too_large: false, missing: true };
    return {
      path,
      type: meta.type,
      tokens: tokensByPath.get(path) ?? null,
      too_large: meta.size_bytes > CONTEXT_MAX_FILE_BYTES,
      missing: false,
    };
  });
}

export interface BriefDocAgent {
  id: string;
  createdAt: Date | string;
  agentPaths: readonly string[];
  skills: readonly { id: string; name: string; paths: readonly string[] }[];
}

const toMs = (d: Date | string): number => (d instanceof Date ? d.getTime() : Date.parse(d));

/**
 * Documents input for the PR brief: agents ordered by creation time then id,
 * each agent's effective set (SPEC-01 AC-40 order), first occurrence of a path wins.
 */
export function unionBriefDocs(agents: readonly BriefDocAgent[]): string[] {
  const ordered = [...agents].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of ordered) {
    const set = buildEffectiveSet(
      a.agentPaths,
      a.skills.map((s) => ({ skill_id: s.id, name: s.name, paths: s.paths })),
    );
    for (const { path } of set) {
      if (seen.has(path)) continue;
      seen.add(path);
      out.push(path);
    }
  }
  return out;
}
