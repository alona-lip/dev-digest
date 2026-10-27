import type { Intent, IssueMeta, UnifiedDiff } from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import {
  DOC_DIRS,
  DOC_EXTENSIONS,
  MAX_BODY_CHARS,
  MAX_FILES_LISTED,
  MAX_GITHUB_REFS,
  MAX_HUNKS_PER_FILE,
  MAX_REPO_FILE_REFS,
  MAX_URL_REFS,
  TRUNCATION_MARKER,
} from './constants.js';

/** The PR being classified — references to itself are skipped. */
export interface PrSelf {
  owner: string;
  name: string;
  number: number;
}

/** A reference found in a PR body, before anything is fetched. */
export type ParsedReference =
  | { kind: 'repo-file'; path: string }
  | { kind: 'github'; owner: string; name: string; number: number }
  | { kind: 'url'; url: string };

/** A reference whose content was fetched; `source` names it in the prompt and logs. */
export interface ResolvedReference {
  kind: ParsedReference['kind'];
  source: string;
  content: string;
}

const URL_RE = /https:\/\/[^\s<>()[\]"'`]+/g;
const GITHUB_ITEM_RE = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)(?:[/?#].*)?$/i;
const GITHUB_BLOB_RE = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/blob\/[^/]+\/([^?#]+)/i;
const CROSS_REPO_ISSUE_RE = /(?:^|[\s(,;:])([\w.-]+)\/([\w.-]+)#(\d+)\b/g;
const BARE_ISSUE_RE = /(?:^|[\s(,;:])#(\d+)\b/g;
const MD_LINK_RE = /\]\(\s*([^)\s]+)\s*\)/g;
const BARE_DOC_RE = new RegExp(
  `(?:\\./)?(?:[\\w-][\\w.-]*/)*(?:${DOC_DIRS.join('|')})/[\\w./-]*?\\.(?:${DOC_EXTENSIONS.join('|')})\\b`,
  'g',
);

/** Repo-relative, inside the repo: no absolute/drive paths, no `..`/`.` segments, no backslashes. */
export function isSafeRepoPath(path: string): boolean {
  if (!path || path.length > 300 || path.includes('\0') || path.includes('\\')) return false;
  if (path.startsWith('/') || /^[a-z]:/i.test(path)) return false;
  return path.split('/').every((seg) => seg !== '' && seg !== '..' && seg !== '.');
}

function isDocFile(path: string): boolean {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return (DOC_EXTENSIONS as readonly string[]).includes(ext);
}

function normalizePath(raw: string): string {
  return raw.replace(/^\.\//, '').replace(/[#?].*$/, '');
}

/**
 * Pull references out of a PR body — pure parsing, nothing fetched:
 * - repo files: markdown links to a relative `.md/.mdx/.txt`, bare paths under
 *   `docs/`, `specs/`, `plans/` (any depth), same-repo GitHub `blob` URLs;
 * - GitHub items: `#N`, `closes #N`, `owner/repo#N`, issue/pull URLs;
 * - any other https:// URL.
 * Unsafe paths and the PR itself are dropped; de-duplicated; capped per kind.
 */
export function parseReferences(body: string | null | undefined, self: PrSelf): ParsedReference[] {
  const text = body ?? '';
  const files = new Map<string, ParsedReference>();
  const github = new Map<string, ParsedReference>();
  const urls = new Map<string, ParsedReference>();
  const sameRepo = (owner: string, name: string) =>
    owner.toLowerCase() === self.owner.toLowerCase() && name.toLowerCase() === self.name.toLowerCase();

  const addFile = (raw: string) => {
    const path = normalizePath(raw);
    if (isSafeRepoPath(path) && isDocFile(path)) files.set(path, { kind: 'repo-file', path });
  };
  const addGithub = (owner: string, name: string, number: number) => {
    if (sameRepo(owner, name) && number === self.number) return;
    github.set(`${owner}/${name}#${number}`.toLowerCase(), { kind: 'github', owner, name, number });
  };

  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?]+$/, '');
    const item = GITHUB_ITEM_RE.exec(url);
    if (item) {
      addGithub(item[1]!, item[2]!, Number(item[3]));
      continue;
    }
    const blob = GITHUB_BLOB_RE.exec(url);
    if (blob && sameRepo(blob[1]!, blob[2]!)) {
      addFile(decodeURIComponent(blob[3]!));
      continue;
    }
    urls.set(url, { kind: 'url', url });
  }

  // URLs are handled — blank them so their paths/anchors don't read as files or `#N`.
  const rest = text.replace(URL_RE, ' ');
  for (const m of rest.matchAll(CROSS_REPO_ISSUE_RE)) addGithub(m[1]!, m[2]!, Number(m[3]));
  for (const m of rest.matchAll(BARE_ISSUE_RE)) addGithub(self.owner, self.name, Number(m[1]));
  for (const m of rest.matchAll(MD_LINK_RE)) {
    const target = m[1]!;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    addFile(target);
  }
  for (const m of rest.matchAll(BARE_DOC_RE)) addFile(m[0]);

  return [
    ...[...files.values()].slice(0, MAX_REPO_FILE_REFS),
    ...[...github.values()].slice(0, MAX_GITHUB_REFS),
    ...[...urls.values()].slice(0, MAX_URL_REFS),
  ];
}

/** How a reference is named in the prompt (`spec:<source>`) and in logs. */
export function referenceSource(ref: ParsedReference, self: Pick<PrSelf, 'owner' | 'name'>): string {
  switch (ref.kind) {
    case 'repo-file':
      return ref.path;
    case 'github':
      return ref.owner.toLowerCase() === self.owner.toLowerCase() &&
        ref.name.toLowerCase() === self.name.toLowerCase()
        ? `#${ref.number}`
        : `${ref.owner}/${ref.name}#${ref.number}`;
    case 'url':
      return ref.url;
  }
}

/** A GitHub issue / PR as reference text. */
export function issueText(issue: Pick<IssueMeta, 'number' | 'title' | 'body'>): string {
  const body = issue.body?.trim();
  return body ? `#${issue.number} ${issue.title}\n\n${body}` : `#${issue.number} ${issue.title}`;
}

/** Crude HTML → text for fetched pages: drop script/style, tags, common entities; squeeze blank runs. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Keep total reference content within `budget` characters: later references
 * are cut (with a marker) or dropped. `truncated` tells the caller to log it.
 */
export function applyBudget(
  refs: ResolvedReference[],
  budget: number,
): { refs: ResolvedReference[]; truncated: boolean } {
  const out: ResolvedReference[] = [];
  let left = budget;
  let truncated = false;
  for (const ref of refs) {
    if (left <= 0) {
      truncated = true;
      continue;
    }
    if (ref.content.length > left) {
      out.push({ ...ref, content: ref.content.slice(0, left) + TRUNCATION_MARKER });
      left = 0;
      truncated = true;
    } else {
      out.push(ref);
      left -= ref.content.length;
    }
  }
  return { refs: out, truncated };
}

/**
 * Changed files with their hunk headers only (`@@ -a,b +c,d @@`) — never the
 * added/removed lines. This is the whole point of the Intent Layer's cheap input.
 */
export function changedFilesOutline(diff: UnifiedDiff): string {
  if (diff.files.length === 0) return '(no changed files)';
  const lines: string[] = [];
  for (const f of diff.files.slice(0, MAX_FILES_LISTED)) {
    lines.push(`${f.path} (+${f.additions} -${f.deletions})`);
    for (const h of f.hunks.slice(0, MAX_HUNKS_PER_FILE)) {
      lines.push(`  @@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    }
    if (f.hunks.length > MAX_HUNKS_PER_FILE) lines.push(`  … ${f.hunks.length - MAX_HUNKS_PER_FILE} more hunk(s)`);
  }
  if (diff.files.length > MAX_FILES_LISTED) lines.push(`… ${diff.files.length - MAX_FILES_LISTED} more file(s)`);
  return lines.join('\n');
}

/**
 * The classifier's user message. Title + changed files are ALWAYS present, so a
 * PR with no description, issue or spec still gets a best-effort intent; the
 * optional sections only sharpen it. Every piece is untrusted data.
 */
export function buildClassifierMessage(input: {
  title: string;
  body: string | null | undefined;
  references: ResolvedReference[];
  diff: UnifiedDiff;
}): string {
  const sections = [`## PR title\n${wrapUntrusted('pr-title', input.title)}`];
  const body = input.body?.trim();
  if (body) sections.push(`## PR description\n${wrapUntrusted('pr-description', body.slice(0, MAX_BODY_CHARS))}`);
  if (input.references.length > 0) {
    const blocks = input.references.map((r) => wrapUntrusted(`spec:${r.source.replace(/"/g, '')}`, r.content));
    sections.push(`## Referenced plans, specs and issues\n${blocks.join('\n\n')}`);
  }
  sections.push(
    `## Changed files (hunk headers only, no code)\n${wrapUntrusted('changed-files', changedFilesOutline(input.diff))}`,
  );
  return sections.join('\n\n');
}

/** chars/4 — an ESTIMATE for the savings log, never for billing. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface TokenSavings {
  fullDiffTokens: number;
  headerOnlyTokens: number;
  savedTokens: number;
  savedPct: number;
}

/** Full diff vs the header-only message actually sent (negative when references outweigh the diff). */
export function tokenSavings(diffRaw: string, message: string): TokenSavings {
  const fullDiffTokens = estimateTokens(diffRaw);
  const headerOnlyTokens = estimateTokens(message);
  const savedTokens = fullDiffTokens - headerOnlyTokens;
  const savedPct = fullDiffTokens > 0 ? Math.round((savedTokens / fullDiffTokens) * 100) : 0;
  return { fullDiffTokens, headerOnlyTokens, savedTokens, savedPct };
}

/** Trim the model's output; never return a blank intent (falls back to the PR title). */
export function normalizeIntent(intent: Intent, title: string): Intent {
  const clean = (items: string[]) => items.map((s) => s.trim()).filter((s) => s.length > 0);
  return {
    intent: intent.intent.trim() || title.trim(),
    in_scope: clean(intent.in_scope),
    out_of_scope: clean(intent.out_of_scope),
  };
}

/** The text reviewer-core wraps as `## Intent` (it appends the trusted scope rule itself). */
export function renderIntentBlock(intent: Intent): string {
  const list = (label: string, items: string[]) =>
    items.length > 0 ? [`${label}:`, ...items.map((i) => `- ${i}`)] : [];
  return [`Intent: ${intent.intent}`, ...list('In scope', intent.in_scope), ...list('Out of scope', intent.out_of_scope)].join(
    '\n',
  );
}
