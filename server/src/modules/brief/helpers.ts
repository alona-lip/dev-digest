import type {
  BriefModelOutput,
  BriefRecord,
  BriefResponse,
  BriefTrimmedInput,
  ChatMessage,
  Intent,
  PrBlastRadius,
  PrFile,
  ReviewFocusItem,
  Risk,
  UnifiedDiff,
} from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import { MAX_FOCUS, MAX_RISKS, TRIM_MARKER } from './constants.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Inclusive 1-based line range. An empty side (`,0` hunk) contributes no range. */
export interface LineRange {
  from: number;
  to: number;
}

/** Per changed file: sizes and hunk line ranges. Numbers only, never code. */
export interface FileStat {
  path: string;
  additions: number;
  deletions: number;
  newRanges: LineRange[];
  oldRanges: LineRange[];
}

/**
 * Everything the prompt is built from. T9's service fills it from the gathered
 * inputs; `fitBudget` trims `documents`, `issues[].text` and `description`.
 * - `blast` must be `null` when the map is missing OR degraded.
 * - `intent` is `null` when none is stored.
 * - `issues[].source` names the issue (`#12`, `owner/repo#3`); `documents[].path`
 *   is the repo path; both are used as untrusted-block labels.
 */
export interface BriefSections {
  system: string;
  title: string;
  description: string | null;
  intent: Intent | null;
  blast: PrBlastRadius | null;
  files: FileStat[];
  issues: { source: string; text: string }[];
  documents: { path: string; text: string }[];
}

export type FitResult =
  | {
      messages: ChatMessage[];
      sections: BriefSections;
      trimmed: { input: BriefTrimmedInput; tokens: number }[];
      inputTokens: number;
    }
  | { tooLarge: true; untrimmableTokens: number };

export type ParsedRef = { ok: true; path: string; from?: number; to?: number } | { ok: false };

// ---------------------------------------------------------------------------
// Hunk ranges / file stats
// ---------------------------------------------------------------------------

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function rangeOf(start: number, len: number): LineRange | null {
  return len > 0 ? { from: start, to: start + len - 1 } : null;
}

function pushRange(list: LineRange[], r: LineRange | null): void {
  if (r) list.push(r);
}

/** Parse only the numbers of each `@@ -a(,b) +c(,d) @@` header; the rest of the patch is ignored. */
export function hunkRangesFromPatch(patch: string | null | undefined): {
  newRanges: LineRange[];
  oldRanges: LineRange[];
} {
  const newRanges: LineRange[] = [];
  const oldRanges: LineRange[] = [];
  for (const line of (patch ?? '').split('\n')) {
    const m = HUNK_HEADER_RE.exec(line);
    if (!m) continue;
    pushRange(oldRanges, rangeOf(Number(m[1]), m[2] === undefined ? 1 : Number(m[2])));
    pushRange(newRanges, rangeOf(Number(m[3]), m[4] === undefined ? 1 : Number(m[4])));
  }
  return { newRanges, oldRanges };
}

/** Stats from a parsed diff — reads `DiffHunk` numbers only (never lines or header text). */
export function fileStatsFromDiff(diff: UnifiedDiff): FileStat[] {
  return diff.files.map((f) => {
    const newRanges: LineRange[] = [];
    const oldRanges: LineRange[] = [];
    for (const h of f.hunks) {
      pushRange(oldRanges, rangeOf(h.oldStart, h.oldLines));
      pushRange(newRanges, rangeOf(h.newStart, h.newLines));
    }
    return { path: f.path, additions: f.additions, deletions: f.deletions, newRanges, oldRanges };
  });
}

/** Stats from GitHub's PR files (patch headers parsed for numbers only). */
export function fileStatsFromPrFiles(files: PrFile[]): FileStat[] {
  return files.map((f) => ({
    path: f.path,
    additions: f.additions,
    deletions: f.deletions,
    ...hunkRangesFromPatch(f.patch),
  }));
}

/**
 * Add the PR's patchless files (binary, pure rename, oversized: no patch, so the
 * diff has no entry) as empty-range stats, so every changed file is a valid path
 * (AC-29, AC-33). `pr_files` only ADDS missing paths; ranges stay diff-sourced (D5).
 * Only rows WITHOUT a patch are merged: a row with a patch that the diff does not
 * list is stale (e.g. no re-sync after a force-push) and must not become a valid path.
 */
export function withPatchlessFiles(
  stats: FileStat[],
  rows: { path: string; additions: number; deletions: number; patch?: string | null }[],
): FileStat[] {
  const known = new Set(stats.map((f) => f.path));
  const extra: FileStat[] = [];
  for (const r of rows) {
    if (r.patch) continue;
    if (known.has(r.path)) continue;
    known.add(r.path);
    extra.push({ path: r.path, additions: r.additions, deletions: r.deletions, newRanges: [], oldRanges: [] });
  }
  return extra.length > 0 ? [...stats, ...extra] : stats;
}

// ---------------------------------------------------------------------------
// Path / ref validation
// ---------------------------------------------------------------------------

/** Caller lines per file; empty when the blast map is missing or degraded (AC-29). */
function callerLinesByFile(blast: PrBlastRadius | null | undefined): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  if (!blast || blast.degraded) return out;
  for (const d of blast.downstream) {
    for (const c of d.callers) {
      const set = out.get(c.file) ?? new Set<number>();
      set.add(c.line);
      out.set(c.file, set);
    }
  }
  return out;
}

/** Changed files plus (only for a non-degraded blast map) caller files. Exact strings. */
export function validPathSet(files: FileStat[], blast: PrBlastRadius | null | undefined): Set<string> {
  const set = new Set(files.map((f) => f.path));
  for (const file of callerLinesByFile(blast).keys()) set.add(file);
  return set;
}

/** `path`, `path:N` or `path:N-M` (1 <= N <= M). Anything else with a numeric-ish tail is invalid. */
export function parseRef(ref: string): ParsedRef {
  const m = /^(.*):(\d+)(?:-(\d+))?$/.exec(ref);
  if (!m) return ref.length > 0 ? { ok: true, path: ref } : { ok: false };
  const path = m[1]!;
  const from = Number(m[2]);
  const to = m[3] === undefined ? from : Number(m[3]);
  if (path.length === 0 || from < 1 || to < from) return { ok: false };
  return { ok: true, path, from, to };
}

interface Resolver {
  has(path: string): boolean;
  /** Does [from, to] touch a hunk range / caller line of this path? */
  intersects(path: string, from: number, to: number): boolean;
}

function makeResolver(files: FileStat[], blast: PrBlastRadius | null | undefined): Resolver {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const callers = callerLinesByFile(blast);
  return {
    has: (path) => byPath.has(path) || callers.has(path),
    intersects(path, from, to) {
      const stat = byPath.get(path);
      if (stat) {
        // New side; old side only for a file with no new-side lines (e.g. deleted).
        const ranges = stat.newRanges.length > 0 ? stat.newRanges : stat.oldRanges;
        return ranges.some((r) => from <= r.to && to >= r.from);
      }
      const lines = callers.get(path);
      if (!lines) return false;
      for (const l of lines) if (l >= from && l <= to) return true;
      return false;
    },
  };
}

/**
 * Ground the model's output against the real diff (AC-29..AC-36). Exact string
 * match for paths. Focus items: invalid file / line outside ranges / duplicate
 * (file+line) dropped, then capped. Risk refs: invalid path removed, a line part
 * that misses every range degrades to the bare path, duplicate refs removed; a
 * risk without refs is dropped; then capped. `dropped` counts invalid + over-cap.
 */
export function postValidate(
  output: BriefModelOutput,
  files: FileStat[],
  blast: PrBlastRadius | null | undefined,
): { risks: Risk[]; review_focus: ReviewFocusItem[]; dropped: { risks: number; review_focus: number } } {
  const r = makeResolver(files, blast);

  const seen = new Set<string>();
  const focus: ReviewFocusItem[] = [];
  for (const item of output.review_focus) {
    if (!r.has(item.file) || !r.intersects(item.file, item.line, item.line)) continue;
    const key = `${item.file}\0${item.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    focus.push(item);
  }

  const risks: Risk[] = [];
  for (const risk of output.risks) {
    const refs: string[] = [];
    for (const raw of risk.file_refs) {
      const p = parseRef(raw);
      if (!p.ok || !r.has(p.path)) continue;
      let ref = p.path;
      if (p.from !== undefined && p.to !== undefined && r.intersects(p.path, p.from, p.to)) ref = raw;
      if (!refs.includes(ref)) refs.push(ref);
    }
    if (refs.length > 0) risks.push({ ...risk, file_refs: refs });
  }

  return {
    risks: risks.slice(0, MAX_RISKS),
    review_focus: focus.slice(0, MAX_FOCUS),
    dropped: {
      risks: output.risks.length - Math.min(risks.length, MAX_RISKS),
      review_focus: output.review_focus.length - Math.min(focus.length, MAX_FOCUS),
    },
  };
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

function rangesText(ranges: LineRange[]): string {
  return `[${ranges.map((x) => (x.from === x.to ? `${x.from}` : `${x.from}-${x.to}`)).join(', ')}]`;
}

/** `path (+a -d) new:[10-20, 40-41] old:[…]` — numbers only. */
export function fileStatLine(f: FileStat): string {
  return `${f.path} (+${f.additions} -${f.deletions}) new:${rangesText(f.newRanges)} old:${rangesText(f.oldRanges)}`;
}

function intentText(intent: Intent): string {
  const list = (label: string, items: string[]) =>
    items.length > 0 ? [`${label}:`, ...items.map((i) => `- ${i}`)] : [];
  return [`Intent: ${intent.intent}`, ...list('In scope', intent.in_scope), ...list('Out of scope', intent.out_of_scope)].join(
    '\n',
  );
}

function blastText(blast: PrBlastRadius): string {
  const lines: string[] = [];
  if (blast.summary.trim()) lines.push(`Summary: ${blast.summary.trim()}`);
  if (blast.changed_symbols.length > 0) {
    lines.push('Changed symbols:', ...blast.changed_symbols.map((s) => `- ${s.name} (${s.kind}) ${s.file}`));
  }
  for (const d of blast.downstream) {
    lines.push(`Impact of ${d.symbol}:`);
    for (const c of d.callers) lines.push(`- caller ${c.name} ${c.file}:${c.line}`);
    for (const e of d.endpoints_affected) lines.push(`- endpoint ${e}`);
    for (const j of d.crons_affected) lines.push(`- cron ${j}`);
  }
  return lines.length > 0 ? lines.join('\n') : '(no downstream impact found)';
}

const label = (prefix: string, name: string) => `${prefix}:${name.replace(/"/g, '')}`;

const documentBlock = (d: { path: string; text: string }) => wrapUntrusted(label('spec', d.path), d.text);

/**
 * `[system, user]`. Title, description, intent, blast, file list, issues and
 * documents are all untrusted data and wrapped. Only numbers from hunks are
 * rendered; no diff body can reach the output (AC-11).
 */
export function buildBriefMessages(input: BriefSections): ChatMessage[] {
  const parts = [`## PR title\n${wrapUntrusted('pr-title', input.title)}`];
  const description = input.description?.trim();
  if (description) parts.push(`## PR description\n${wrapUntrusted('pr-description', description)}`);
  if (input.intent) parts.push(`## Intent\n${wrapUntrusted('pr-intent', intentText(input.intent))}`);
  if (input.blast) parts.push(`## Blast radius\n${wrapUntrusted('blast-radius', blastText(input.blast))}`);
  parts.push(
    `## Changed files (line ranges only, no code)\n${wrapUntrusted(
      'changed-files',
      input.files.length > 0 ? input.files.map(fileStatLine).join('\n') : '(no changed files)',
    )}`,
  );
  if (input.issues.length > 0) {
    const blocks = input.issues.map((i) => wrapUntrusted(label('issue', i.source), i.text));
    parts.push(`## Linked issues\n${blocks.join('\n\n')}`);
  }
  if (input.documents.length > 0) {
    const blocks = input.documents.map(documentBlock);
    parts.push(`## Project documents\n${blocks.join('\n\n')}`);
  }
  return [
    { role: 'system', content: input.system },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

function cut(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + TRIM_MARKER : text;
}

/**
 * Largest shared char cap in [1, maxLen-1] for which `fits(cap)` holds, or 0 if
 * none (caller then omits the text entirely, so the floor equals the untrimmable
 * input and carries no marker).
 */
function largestFittingCap(maxLen: number, fits: (cap: number) => boolean): number {
  let lo = 1;
  let hi = maxLen - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/**
 * Keep ALL messages within `budget` tokens (`count` is injected; the server
 * passes tiktoken). Order (AC-18): drop documents from the end, then shorten
 * issue text, then shorten the description. Title, intent, blast, file stats and
 * the system prompt are never trimmed; if they alone exceed the budget the result
 * is `{tooLarge}` (AC-20). `trimmed[].tokens` is the tokens each step removed.
 */
export function fitBudget(sections: BriefSections, count: (s: string) => number, budget: number): FitResult {
  const total = (s: BriefSections) => buildBriefMessages(s).reduce((n, m) => n + count(m.content), 0);

  const floor: BriefSections = { ...sections, description: null, issues: [], documents: [] };
  const untrimmableTokens = total(floor);
  if (untrimmableTokens > budget) return { tooLarge: true, untrimmableTokens };

  let cur = sections;
  let tokens = total(cur);
  const trimmed: { input: BriefTrimmedInput; tokens: number }[] = [];
  const step = (input: BriefTrimmedInput, next: BriefSections) => {
    const after = total(next);
    if (after < tokens) trimmed.push({ input, tokens: tokens - after });
    cur = next;
    tokens = after;
  };

  if (tokens > budget && cur.documents.length > 0) {
    // Count the base and each document block once (not the whole prompt per dropped
    // document: that is O(n^2 * size) on up-to-1 MB documents). The per-block sum is
    // only an estimate (token rounding at block boundaries, separators), so the
    // exact count of the assembled messages has the final say.
    const all = cur.documents;
    const base = cur;
    const exact = (k: number) => total({ ...base, documents: all.slice(0, k) });
    const baseTokens = total({ ...base, documents: [] });
    const blockTokens = all.map((d) => count(documentBlock(d)));
    let k = all.length;
    let estimate = baseTokens + blockTokens.reduce((a, b) => a + b, 0);
    while (k > 0 && estimate > budget) estimate -= blockTokens[--k]!;
    while (k > 0 && exact(k) > budget) k--;
    while (k < all.length && exact(k + 1) <= budget) k++;
    step('specs', { ...base, documents: all.slice(0, k) });
  }

  if (tokens > budget && cur.issues.length > 0) {
    const base = cur;
    const maxLen = Math.max(...base.issues.map((i) => i.text.length));
    const cap = largestFittingCap(maxLen, (c) =>
      total({ ...base, issues: base.issues.map((i) => ({ ...i, text: cut(i.text, c) })) }) <= budget,
    );
    step(
      'linked_issue',
      cap === 0
        ? { ...base, issues: [] }
        : { ...base, issues: base.issues.map((i) => ({ ...i, text: cut(i.text, cap) })) },
    );
  }

  if (tokens > budget && cur.description) {
    const base = cur;
    const text = base.description!;
    const cap = largestFittingCap(text.length, (c) => total({ ...base, description: cut(text, c) }) <= budget);
    step('description', { ...base, description: cap === 0 ? null : cut(text, cap) });
  }

  return { messages: buildBriefMessages(cur), sections: cur, trimmed, inputTokens: tokens };
}

// ---------------------------------------------------------------------------
// Stale / response
// ---------------------------------------------------------------------------

/** AC-5: stale exactly when the stored head differs from the PR's current head. */
export function isStale(record: Pick<BriefRecord, 'head_sha'>, pullHeadSha: string): boolean {
  return record.head_sha !== pullHeadSha;
}

export function toBriefResponse(record: BriefRecord | null | undefined, pullHeadSha: string): BriefResponse {
  if (!record) return { status: 'none' };
  return { status: 'ready', stale: isStale(record, pullHeadSha), current_head_sha: pullHeadSha, brief: record };
}
