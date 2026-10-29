import {
  PROJECT_CONTEXT_TOKEN_BUDGET,
  type ContextAttachmentDoc,
  type ContextAttachments,
  type ContextDoc,
  type ContextDocType,
} from "@devdigest/shared";

/** One line of the picker: a repo document or an attached path that is gone. */
export interface PickerRow {
  path: string;
  type: ContextDocType | null;
  tokens: number | null;
  too_large: boolean;
  missing: boolean;
  attached: boolean;
}

/** An item of the effective set, in prompt order. */
export interface EffectiveItem {
  path: string;
  tokens: number | null;
  too_large: boolean;
}

/** An inherited (locked) row: a skill's document shown on the agent's tab. */
export interface InheritedRow extends PickerRow {
  via_skill: { skill_id: string; name: string };
}

export interface BudgetResult {
  path: string;
  status: "attached" | "over_budget";
}

/** File name and directory of a repo-relative path ("a/b/c.md" → "c.md", "a/b"). */
export function splitPath(path: string): { name: string; dir: string } {
  const i = path.lastIndexOf("/");
  return i < 0 ? { name: path, dir: "" } : { name: path.slice(i + 1), dir: path.slice(0, i) };
}

/**
 * Attached paths first, in attachment order (that order is the prompt order) —
 * including attached paths that are gone (`missing`) — then every other repo
 * document in list order.
 */
export function mergeRows(
  listDocs: readonly ContextDoc[],
  attachments: Pick<ContextAttachments, "paths" | "docs"> | undefined,
): PickerRow[] {
  const byPath = new Map(listDocs.map((d) => [d.path, d]));
  const attachedDocs = new Map((attachments?.docs ?? []).map((d) => [d.path, d]));
  const paths = attachments?.paths ?? [];
  const attachedSet = new Set(paths);

  const attached: PickerRow[] = paths.map((path) => {
    const listed = byPath.get(path);
    const meta = attachedDocs.get(path);
    return {
      path,
      type: listed?.type ?? meta?.type ?? null,
      tokens: listed?.tokens ?? meta?.tokens ?? null,
      too_large: listed?.too_large ?? meta?.too_large ?? false,
      missing: meta?.missing ?? false,
      attached: true,
    };
  });
  const rest: PickerRow[] = listDocs
    .filter((d) => !attachedSet.has(d.path))
    .map((d) => ({
      path: d.path,
      type: d.type,
      tokens: d.tokens,
      too_large: d.too_large,
      missing: false,
      attached: false,
    }));
  return [...attached, ...rest];
}

/** Flip a path in the ordered list: detach it, or append it to the end. */
export function togglePath(paths: readonly string[], path: string): string[] {
  return paths.includes(path) ? paths.filter((p) => p !== path) : [...paths, path];
}

/** Move `from` to the position `to` currently has (both paths of the list). */
export function movePath(paths: readonly string[], from: string, to: string): string[] {
  const i = paths.indexOf(from);
  const j = paths.indexOf(to);
  if (i < 0 || j < 0 || i === j) return [...paths];
  const next = [...paths];
  const [moved] = next.splice(i, 1);
  next.splice(j, 0, moved!);
  return next;
}

/** Case-insensitive substring filter over the full path. */
export function filterRows<T extends { path: string }>(rows: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q ? rows.filter((r) => r.path.toLowerCase().includes(q)) : [...rows];
}

/** Inherited rows whose path the owner did not attach itself (a duplicate shows once, as the own one). */
export function inheritedRows(attachments: ContextAttachments | undefined): InheritedRow[] {
  if (!attachments) return [];
  const own = new Set(attachments.paths);
  const seen = new Set<string>();
  const out: InheritedRow[] = [];
  for (const d of attachments.inherited) {
    if (own.has(d.path) || seen.has(d.path)) continue;
    seen.add(d.path);
    out.push({
      path: d.path,
      type: d.type,
      tokens: d.tokens,
      too_large: d.too_large,
      missing: d.missing,
      attached: true,
      via_skill: d.via_skill,
    });
  }
  return out;
}

const toItem = (d: Pick<ContextAttachmentDoc, "path" | "tokens" | "too_large">): EffectiveItem => ({
  path: d.path,
  tokens: d.tokens,
  too_large: d.too_large,
});

/** The run's effective set: own documents, then inherited ones, no duplicates; missing files drop out. */
export function effectiveSet(attachments: ContextAttachments | undefined): EffectiveItem[] {
  if (!attachments) return [];
  const seen = new Set<string>();
  const out: EffectiveItem[] = [];
  for (const d of [...attachments.docs, ...attachments.inherited]) {
    if (d.missing || seen.has(d.path)) continue;
    seen.add(d.path);
    out.push(toItem(d));
  }
  return out;
}

/** Token sum of the set (null tokens count 0); an empty set is 0. */
export function sumTokens(items: readonly EffectiveItem[]): number {
  return items.reduce((sum, it) => sum + (it.tokens ?? 0), 0);
}

/**
 * Greedy, in order — a mirror of the server's `applyBudget`: a null-token or
 * > 1 MB item is `over_budget` without using budget; a later, smaller item may
 * still fit after a skipped one.
 */
export function applyBudget(
  items: readonly EffectiveItem[],
  budget: number = PROJECT_CONTEXT_TOKEN_BUDGET,
): BudgetResult[] {
  let sum = 0;
  return items.map((it) => {
    if (it.tokens === null || it.too_large) return { path: it.path, status: "over_budget" as const };
    if (sum + it.tokens <= budget) {
      sum += it.tokens;
      return { path: it.path, status: "attached" as const };
    }
    return { path: it.path, status: "over_budget" as const };
  });
}
