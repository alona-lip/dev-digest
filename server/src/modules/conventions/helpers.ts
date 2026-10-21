import type { ConventionCandidate, ConventionSkillDraft } from '@devdigest/shared';
import type { ConventionRow } from '../../db/rows.js';
import {
  LINE_TOLERANCE,
  MAX_EVIDENCE_LINES,
  MAX_FILE_CHARS,
  MAX_FILE_LINES,
  MAX_SAMPLE_CHARS,
  MAX_SKILL_BODY_CHARS,
  MIN_SNIPPET_CHARS,
  SKILL_NAME,
} from './constants.js';
import type { ExtractedConvention } from './schema.js';

// ---------------------------------------------------------------- sampling

export interface SampleFile {
  path: string;
  content: string;
}

export interface Sample {
  /** The files sent to the model, already cut — evidence is checked against these. */
  files: SampleFile[];
  /** Line-numbered listing of `files`. */
  text: string;
}

/** Keep the first lines of a file, cut on a line boundary; line N stays line N. */
export function truncateFile(content: string): string {
  const lines = content.split('\n').slice(0, MAX_FILE_LINES);
  let size = 0;
  let keep = 0;
  for (const line of lines) {
    size += line.length + 1;
    if (size > MAX_FILE_CHARS) break;
    keep++;
  }
  return lines.slice(0, keep).join('\n');
}

/** `path` plus a 1-based line gutter — the gutter is what makes a citation checkable. */
export function renderFile(file: SampleFile): string {
  const lines = file.content.split('\n');
  const width = String(lines.length).length;
  const body = lines.map((l, i) => `${String(i + 1).padStart(width)} | ${l}`).join('\n');
  return `=== FILE: ${file.path} ===\n${body}`;
}

/**
 * Cut every file, drop empty ones, and add files in order until the budget is
 * spent. A file that doesn't fit is left out whole, so no file is half-shown.
 */
export function buildSample(files: SampleFile[], budget = MAX_SAMPLE_CHARS): Sample {
  const kept: SampleFile[] = [];
  const parts: string[] = [];
  let size = 0;
  for (const f of files) {
    const content = truncateFile(f.content);
    if (!content.trim()) continue;
    const rendered = renderFile({ path: f.path, content });
    if (size + rendered.length > budget) continue;
    size += rendered.length + 2;
    kept.push({ path: f.path, content });
    parts.push(rendered);
  }
  return { files: kept, text: parts.join('\n\n') };
}

// ---------------------------------------------------------------- evidence gate

export type DropReason =
  | 'file_not_sampled'
  | 'line_out_of_range'
  | 'snippet_too_short'
  | 'snippet_not_found';

export interface VerifiedConvention {
  rule: string;
  category: ExtractedConvention['category'];
  confidence: number;
  evidencePath: string;
  evidenceStartLine: number;
  evidenceEndLine: number;
  /** Sliced from the file at the verified lines — never the model's text. */
  evidenceSnippet: string;
}

export type VerifyResult = { ok: true; value: VerifiedConvention } | { ok: false; reason: DropReason };

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
/** The model sometimes copies our gutter (`  12 | code`) into the snippet. */
const stripGutter = (s: string) => s.replace(/^\s*\d+\s*\|\s?/, '');
const normalizePath = (p: string) => p.trim().replace(/^\.\//, '').replace(/^\/+/, '');

export function clampConfidence(c: number): number {
  if (!Number.isFinite(c)) return 0.5;
  return Math.min(1, Math.max(0, c));
}

/** Remove the indent shared by every non-empty line. */
export function dedent(text: string): string {
  const lines = text.split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(cut)).join('\n');
}

/**
 * Where the snippet's non-empty lines occur as consecutive non-empty file lines
 * starting at file line `start` (1-based); returns the 1-based end line or null.
 * A file line matches when it contains the snippet line (the model may trim it).
 */
function matchAt(fileLines: string[], start: number, snippetLines: string[]): number | null {
  let i = start - 1;
  let last = -1;
  for (const want of snippetLines) {
    while (i < fileLines.length && !norm(fileLines[i]!)) i++;
    if (i >= fileLines.length || !norm(fileLines[i]!).includes(want)) return null;
    last = i;
    i++;
  }
  return last + 1;
}

/**
 * The evidence gate. A candidate survives only if
 *   1. its file is one of the files the model was shown (the model never picks a path to read),
 *   2. its start line exists in that file,
 *   3. its snippet really is in the file within LINE_TOLERANCE lines of the cited line.
 * A small line drift is corrected to where the snippet actually is; anything else is dropped.
 */
export function verifyEvidence(c: ExtractedConvention, files: Map<string, string>): VerifyResult {
  const path = normalizePath(c.evidence.path);
  const content = files.get(path);
  if (content === undefined) return { ok: false, reason: 'file_not_sampled' };

  const fileLines = content.split('\n');
  const cited = c.evidence.start_line;
  if (!Number.isInteger(cited) || cited < 1 || cited > fileLines.length) {
    return { ok: false, reason: 'line_out_of_range' };
  }

  const snippetLines = c.evidence.snippet
    .split('\n')
    .map((l) => norm(stripGutter(l)))
    .filter(Boolean)
    .slice(0, MAX_EVIDENCE_LINES);
  if (snippetLines.join('').replace(/\s/g, '').length < MIN_SNIPPET_CHARS) {
    return { ok: false, reason: 'snippet_too_short' };
  }

  // Try the cited line first, then step outwards: the nearest hit wins.
  for (let d = 0; d <= LINE_TOLERANCE; d++) {
    for (const start of d === 0 ? [cited] : [cited - d, cited + d]) {
      if (start < 1 || start > fileLines.length) continue;
      const end = matchAt(fileLines, start, snippetLines);
      if (end === null) continue;
      // `start` may sit on blank lines before the first match — skip them.
      let first = start;
      while (!norm(fileLines[first - 1]!)) first++;
      return {
        ok: true,
        value: {
          rule: c.rule.trim(),
          category: c.category,
          confidence: clampConfidence(c.confidence),
          evidencePath: path,
          evidenceStartLine: first,
          evidenceEndLine: end,
          evidenceSnippet: dedent(fileLines.slice(first - 1, end).join('\n')),
        },
      };
    }
  }
  return { ok: false, reason: 'snippet_not_found' };
}

export interface GroundingOutcome {
  kept: VerifiedConvention[];
  dropped: { rule: string; reason: DropReason }[];
}

export function groundCandidates(candidates: ExtractedConvention[], files: SampleFile[]): GroundingOutcome {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const out: GroundingOutcome = { kept: [], dropped: [] };
  for (const c of candidates) {
    const r = verifyEvidence(c, byPath);
    if (r.ok) out.kept.push(r.value);
    else out.dropped.push({ rule: c.rule, reason: r.reason });
  }
  return out;
}

// ---------------------------------------------------------------- dedupe

/** Rule identity: case, punctuation, backticks and spacing don't make a new rule. */
export function ruleKey(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/[`'"().,;:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Drop candidates whose rule is already on the list (accepted OR rejected — a
 * rejected rule must not come back on re-scan) or repeated within the batch.
 * Higher confidence wins inside the batch.
 */
export function dedupeRules<T extends { rule: string; confidence: number }>(
  candidates: T[],
  existingRules: string[],
): { fresh: T[]; duplicates: number } {
  const seen = new Set(existingRules.map(ruleKey));
  const fresh: T[] = [];
  for (const c of [...candidates].sort((a, b) => b.confidence - a.confidence)) {
    const key = ruleKey(c.rule);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fresh.push(c);
  }
  return { fresh, duplicates: candidates.length - fresh.length };
}

// ---------------------------------------------------------------- skill draft

const FENCE_LANG: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js', py: 'python', go: 'go',
  rb: 'ruby', java: 'java', kt: 'kotlin', rs: 'rust', cs: 'csharp', php: 'php', json: 'json',
  css: 'css', scss: 'scss', html: 'html', sql: 'sql', sh: 'bash', yml: 'yaml', yaml: 'yaml',
};

function fenceLang(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return FENCE_LANG[ext] ?? '';
}

function codeBlock(path: string, code: string): string {
  // A snippet that itself contains ``` needs a longer fence.
  const fence = code.includes('```') ? '````' : '```';
  return `${fence}${fenceLang(path)}\n${code}\n${fence}`;
}

export function lineRange(start: number, end: number): string {
  return start === end ? String(start) : `${start}-${end}`;
}

/** The skill the ACCEPTED candidates merge into; the user edits it before saving. */
export function buildSkillDraft(
  repoName: string,
  accepted: ConventionCandidate[],
): Omit<ConventionSkillDraft, 'accepted_count' | 'existing_skill'> {
  const header =
    `# ${SKILL_NAME}\n\n` +
    `House conventions for \`${repoName}\`. Flag changes that violate any rule below and cite ` +
    'the offending `file:line`.';
  const section = (c: ConventionCandidate, withCode: boolean) => {
    const where = `Detected in \`${c.evidence_path}:${lineRange(c.evidence_start_line, c.evidence_end_line)}\``;
    return withCode
      ? `## ${c.rule}\n\n${where}:\n\n${codeBlock(c.evidence_path, c.evidence_snippet)}`
      : `## ${c.rule}\n\n${where}.`;
  };
  let body = [header, ...accepted.map((c) => section(c, true))].join('\n\n') + '\n';
  if (body.length > MAX_SKILL_BODY_CHARS) {
    body = [header, ...accepted.map((c) => section(c, false))].join('\n\n') + '\n';
  }
  const n = accepted.length;
  return {
    name: SKILL_NAME,
    description:
      `Use when reviewing changes to ${repoName}: flag code that breaks its ${n} house ` +
      `convention${n === 1 ? '' : 's'} and cite the offending file:line.`,
    type: 'convention',
    enabled: true,
    body,
  };
}

// ---------------------------------------------------------------- dto

export function toConventionDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    repo_id: row.repoId ?? '',
    category: row.category,
    rule: row.rule,
    evidence_path: row.evidencePath,
    evidence_start_line: row.evidenceStartLine,
    evidence_end_line: row.evidenceEndLine,
    evidence_snippet: row.evidenceSnippet,
    confidence: row.confidence,
    status: row.status,
    created_at: row.createdAt.toISOString(),
  };
}
