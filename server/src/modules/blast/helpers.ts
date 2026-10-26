import type {
  BlastDegradedReason,
  BlastRadius,
  DownstreamImpact,
  PathPullRequests,
  PrHistory,
} from '@devdigest/shared';
import type { BlastCallerRow, BlastResult, DegradedReason } from '../repo-intel/index.js';

// Compile-time tie: repo-intel's DegradedReason and the wire BlastDegradedReason must stay identical.
type _Assert<T extends true> = T;
type _Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type _DegradedReasonInSync = _Assert<_Same<DegradedReason, BlastDegradedReason>>;

export interface BlastCounts {
  symbols: number;
  callers: number;
  endpoints: number;
  crons: number;
}

/** `"<S> changed symbols · <C> callers · <E> endpoints · <J> crons"` (+ degraded suffix). Always plural. */
export function buildSummary(counts: BlastCounts, degraded: boolean, reason: DegradedReason | null): string {
  const base = `${counts.symbols} changed symbols · ${counts.callers} callers · ${counts.endpoints} endpoints · ${counts.crons} crons`;
  return degraded ? `${base} · index degraded: ${reason ?? 'no_data'}` : base;
}

/**
 * Facade `BlastResult` → the wire `BlastRadius`: one group per changed symbol that
 * has callers, ordered by the highest caller rank; callers by rank (stable);
 * a caller in the symbol's own declaration file is dropped; endpoints/crons are
 * the deduplicated union over the group's caller files. `summary` is left to the
 * service (it needs the degraded flag).
 */
export function toBlastRadius(result: BlastResult): Omit<BlastRadius, 'summary'> {
  const declFiles = new Map<string, Set<string>>();
  for (const s of result.changedSymbols) {
    const set = declFiles.get(s.name);
    if (set) set.add(s.file);
    else declFiles.set(s.name, new Set([s.file]));
  }

  const groups = new Map<string, BlastCallerRow[]>();
  for (const c of result.callers) {
    if (declFiles.get(c.viaSymbol)?.has(c.file)) continue;
    const arr = groups.get(c.viaSymbol);
    if (arr) arr.push(c);
    else groups.set(c.viaSymbol, [c]);
  }

  const ranked = [...groups.entries()].map(([symbol, rows]) => {
    const sorted = [...rows].sort((a, b) => b.rank - a.rank);
    return { symbol, sorted, top: sorted[0]!.rank };
  });
  ranked.sort((a, b) => b.top - a.top); // stable: ties keep first-seen order

  const downstream: DownstreamImpact[] = ranked.map(({ symbol, sorted }) => {
    const endpoints = new Set<string>();
    const crons = new Set<string>();
    for (const c of sorted) {
      const facts = result.factsByFile?.[c.file];
      facts?.endpoints.forEach((e) => endpoints.add(e));
      facts?.crons.forEach((j) => crons.add(j));
    }
    return {
      symbol,
      callers: sorted.map((c) => ({ name: c.symbol, file: c.file, line: c.line })),
      endpoints_affected: [...endpoints],
      crons_affected: [...crons],
    };
  });

  return {
    changed_symbols: result.changedSymbols.map((s) => ({ name: s.name, file: s.file, kind: s.kind })),
    downstream,
  };
}

/** Counts for the summary: endpoints/crons unique across groups. */
export function countBlast(blast: Omit<BlastRadius, 'summary'>): BlastCounts {
  const endpoints = new Set<string>();
  const crons = new Set<string>();
  let callers = 0;
  for (const d of blast.downstream) {
    callers += d.callers.length;
    d.endpoints_affected.forEach((e) => endpoints.add(e));
    d.crons_affected.forEach((j) => crons.add(j));
  }
  return { symbols: blast.changed_symbols.length, callers, endpoints: endpoints.size, crons: crons.size };
}

/**
 * Per-path GitHub results → `PrHistory`: dedupe by PR number across paths,
 * `files_overlap` = unique paths it touched (input order), drop the current PR
 * and unmerged PRs, sort by overlap desc then `merged_at` desc, cap at `limit`.
 */
export function toPrHistory(perPath: PathPullRequests[], currentNumber: number, limit: number): PrHistory {
  const byNumber = new Map<number, { title: string; merged_at: string; author: string; files: string[] }>();
  for (const { path, prs } of perPath) {
    for (const pr of prs) {
      if (pr.number === currentNumber || pr.merged_at === null) continue;
      const entry = byNumber.get(pr.number);
      if (!entry) {
        byNumber.set(pr.number, { title: pr.title, merged_at: pr.merged_at, author: pr.author, files: [path] });
      } else if (!entry.files.includes(path)) {
        entry.files.push(path);
      }
    }
  }
  const history = [...byNumber.entries()]
    .map(([pr_number, e]) => ({
      pr_number,
      title: e.title,
      merged_at: e.merged_at,
      author: e.author,
      files_overlap: e.files,
      notes: '',
    }))
    .sort((a, b) => b.files_overlap.length - a.files_overlap.length || b.merged_at.localeCompare(a.merged_at))
    .slice(0, limit);
  return { history };
}
