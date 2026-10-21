import { unzipSync } from 'fflate';
import { SkillType, type IgnoredFileReason, type SkillImportPreview } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
import type { Skill, SkillScan, SkillScanFinding, SkillVersion } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import {
  BINARY_EXT,
  EXECUTABLE_EXT,
  INJECTION_PATTERNS,
  MARKDOWN_CONTENT_TYPES,
  MAX_ARCHIVE_ENTRIES,
  MAX_BODY_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_IMPORT_FILE_BYTES,
  MAX_NAME_CHARS,
  MAX_SCAN_EXCERPT_CHARS,
  MAX_SCAN_FINDINGS,
  MAX_SKILL_MD_BYTES,
  ZIP_CONTENT_TYPES,
} from './constants.js';

/**
 * Pure helpers for the skills module — row ⇄ DTO mapping and the import
 * parser. No I/O. The parser only ever TEXT-decodes one `SKILL.md`; nothing
 * else in an archive is inflated, written to disk, or executed.
 */

export function toSkillDto(row: SkillRow, tokens: number): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    source: row.source,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
    tokens,
    created_at: row.createdAt.toISOString(),
    scan: {
      status: row.scanStatus,
      method: row.scanMethod,
      findings: row.scanFindings ?? [],
      scanned_at: row.scannedAt ? row.scannedAt.toISOString() : null,
    },
  };
}

export function toSkillVersionDto(row: SkillVersionRow, currentVersion: number): SkillVersion {
  return {
    version: row.version,
    body: row.body,
    message: row.message,
    created_at: row.createdAt.toISOString(),
    current: row.version === currentVersion,
  };
}

/** num / den, or null when there is nothing to divide by ("—" in the UI, never 0%). */
export function rate(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

// ---- Import --------------------------------------------------------------

export interface ParsedSkillMarkdown {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  warnings: string[];
}

function stripQuotes(v: string): string {
  const t = v.trim();
  return t.length >= 2 && /^(['"]).*\1$/.test(t) ? t.slice(1, -1) : t;
}

/** Minimal `key: value` frontmatter (plus `|` / `>` block scalars). No YAML dependency. */
function parseFrontmatter(raw: string): { meta: Record<string, string>; rest: string } | null {
  if (!raw.startsWith('---\n')) return null;
  const end = raw.indexOf('\n---', 4);
  if (end === -1) return null;
  const block = raw.slice(4, end).split('\n');
  const after = raw.indexOf('\n', end + 1);
  const rest = after === -1 ? '' : raw.slice(after + 1);
  const meta: Record<string, string> = {};
  for (let i = 0; i < block.length; i++) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(block[i]!);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    if (val === '|' || val === '>' || val === '|-' || val === '>-') {
      const lines: string[] = [];
      while (i + 1 < block.length && /^\s+\S/.test(block[i + 1]!)) lines.push(block[++i]!.trim());
      meta[key] = lines.join(val.startsWith('|') ? '\n' : ' ');
    } else {
      meta[key] = stripQuotes(val);
    }
  }
  return { meta, rest };
}

/** Parse a SKILL.md / skill .md file into the editable core of a skill. */
export function parseSkillMarkdown(text: string, filename: string): ParsedSkillMarkdown {
  const warnings: string[] = [];
  const raw = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const fm = parseFrontmatter(raw);
  const body = (fm ? fm.rest : raw).trim();
  if (!body) throw new ValidationError('The skill has no body text');
  if (!fm) warnings.push('No frontmatter found — name and description were inferred.');

  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  const fileBase = filename.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
  let name = fm?.meta.name?.trim() || heading || fileBase;
  if (!fm?.meta.name) warnings.push(`No "name" in frontmatter — using "${name}".`);
  if (name.length > MAX_NAME_CHARS) {
    name = name.slice(0, MAX_NAME_CHARS).trim();
    warnings.push(`Name was longer than ${MAX_NAME_CHARS} characters and was shortened.`);
  }

  let description = fm?.meta.description?.trim() ?? '';
  if (!description) {
    const firstPara = body.split(/\n\s*\n/).find((p) => p.trim() && !p.trim().startsWith('#'));
    description = (firstPara ?? name).replace(/\s+/g, ' ').trim();
    warnings.push('No "description" in frontmatter — taken from the first paragraph. Rewrite it as a directive.');
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    description = description.slice(0, MAX_DESCRIPTION_CHARS).trim();
    warnings.push(`Description was longer than ${MAX_DESCRIPTION_CHARS} characters and was shortened.`);
  }

  const parsedType = SkillType.safeParse(fm?.meta.type);
  if (body.length > MAX_BODY_CHARS) {
    warnings.push(`Body is over ${MAX_BODY_CHARS} characters — shorten it before saving.`);
  }
  return { name, description, type: parsedType.success ? parsedType.data : 'custom', body, warnings };
}

function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i + 1).toLowerCase();
}

function ignoreReason(path: string, size: number): IgnoredFileReason {
  const ext = extOf(path);
  if (EXECUTABLE_EXT.has(ext)) return 'executable';
  if (BINARY_EXT.has(ext)) return 'binary';
  if (size > MAX_SKILL_MD_BYTES) return 'too_large';
  return 'not_core';
}

/** A SKILL.md at the archive root or exactly one folder down. */
const CORE_RE = /^(?:[^/]+\/)?SKILL\.md$/i;

function isUnsafePath(path: string): boolean {
  return path.startsWith('/') || path.split('/').includes('..') || path.includes('\\');
}

export interface ArchiveCore {
  path: string;
  text: string;
  ignored: SkillImportPreview['ignored_files'];
  warnings: string[];
}

/**
 * Pull the one text file we care about out of a zip. Entries are inspected from
 * the central directory only; every entry except the SKILL.md candidate is
 * skipped by `filter` and so never inflated.
 */
export function readSkillArchive(bytes: Uint8Array): ArchiveCore {
  const seen: { path: string; size: number }[] = [];
  const warnings: string[] = [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        if (f.name.endsWith('/')) return false; // directory entry
        if (seen.length >= MAX_ARCHIVE_ENTRIES) {
          throw new ValidationError(`Archive has more than ${MAX_ARCHIVE_ENTRIES} entries`);
        }
        seen.push({ path: f.name, size: f.originalSize });
        return CORE_RE.test(f.name) && !isUnsafePath(f.name) && f.originalSize <= MAX_SKILL_MD_BYTES;
      },
    });
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError('Could not read the archive — is it a valid .zip file?');
  }

  const candidates = Object.keys(files).sort((a, b) => a.split('/').length - b.split('/').length);
  const corePath = candidates[0];
  if (!corePath) {
    const tooBig = seen.find((e) => CORE_RE.test(e.path) && e.size > MAX_SKILL_MD_BYTES);
    throw new ValidationError(
      tooBig
        ? `SKILL.md is larger than ${MAX_SKILL_MD_BYTES / 1024} KB`
        : 'No SKILL.md found at the archive root or in a single top-level folder',
    );
  }
  const data = files[corePath]!;
  if (data.byteLength > MAX_SKILL_MD_BYTES) {
    throw new ValidationError(`SKILL.md is larger than ${MAX_SKILL_MD_BYTES / 1024} KB`);
  }
  if (candidates.length > 1) warnings.push(`Several SKILL.md files found — using ${corePath}.`);

  const ignored: ArchiveCore['ignored'] = [];
  for (const e of seen) {
    if (e.path === corePath) continue;
    if (isUnsafePath(e.path)) {
      ignored.push({ path: e.path.replace(/\\/g, '/'), reason: 'not_core' });
      warnings.push(`Ignored an entry with an unsafe path: ${e.path}`);
      continue;
    }
    ignored.push({ path: e.path, reason: ignoreReason(e.path, e.size) });
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(data);
  return { path: corePath, text, ignored, warnings };
}

/** Build the (unsaved) import preview from an uploaded file. `name_conflict` and `scan` are set by the service. */
export function buildImportPreview(
  filename: string,
  bytes: Uint8Array,
): Omit<SkillImportPreview, 'name_conflict' | 'scan'> {
  if (bytes.byteLength === 0) throw new ValidationError('The file is empty');
  if (bytes.byteLength > MAX_IMPORT_FILE_BYTES) {
    throw new ValidationError(`File is larger than ${MAX_IMPORT_FILE_BYTES / 1024} KB`);
  }
  const lower = filename.toLowerCase();
  if (lower.endsWith('.zip')) {
    const core = readSkillArchive(bytes);
    const parsed = parseSkillMarkdown(core.text, core.path);
    return {
      name: parsed.name,
      description: parsed.description,
      type: parsed.type,
      body: parsed.body,
      source_file: `${filename}:${core.path}`,
      ignored_files: core.ignored,
      warnings: [...core.warnings, ...parsed.warnings],
    };
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    const parsed = parseSkillMarkdown(new TextDecoder('utf-8').decode(bytes), filename);
    return {
      name: parsed.name,
      description: parsed.description,
      type: parsed.type,
      body: parsed.body,
      source_file: filename,
      ignored_files: [],
      warnings: parsed.warnings,
    };
  }
  throw new ValidationError('Only .md and .zip files can be imported');
}

// ---- Import from URL -----------------------------------------------------

const GITHUB_BLOB_RE = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/;

/**
 * Validate a user-supplied skill URL and make it fetchable as RAW text:
 * https only, no credentials, and a github.com "blob" page (HTML) rewritten to
 * raw.githubusercontent.com. The address check is the fetcher's job.
 */
export function normalizeSkillUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ValidationError('Not a valid URL');
  }
  if (url.protocol !== 'https:') throw new ValidationError('Only https:// URLs can be imported');
  if (url.username || url.password) throw new ValidationError('URLs with credentials are not allowed');
  url.hash = '';
  const blob = url.hostname === 'github.com' ? GITHUB_BLOB_RE.exec(url.pathname) : null;
  if (blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`;
  return url.toString();
}

/**
 * The filename `buildImportPreview` branches on, from the fetched URL and its
 * content type. The path's extension wins. Without one, the content type
 * decides. An HTML page is never a skill, whatever the path says.
 */
export function filenameFromUrl(finalUrl: string, contentType: string | null): string {
  const ct = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (ct === 'text/html' || ct === 'application/xhtml+xml') {
    throw new ValidationError('The URL returned an HTML page — link the raw .md or .zip file');
  }
  let segment = '';
  try {
    segment = decodeURIComponent(new URL(finalUrl).pathname.split('/').pop() ?? '');
  } catch {
    segment = '';
  }
  segment = segment.slice(-100);
  if (/\.(md|markdown|zip)$/i.test(segment)) return segment;
  if (ZIP_CONTENT_TYPES.has(ct)) return `${segment || 'skill'}.zip`;
  if (MARKDOWN_CONTENT_TYPES.has(ct)) return `${segment || 'SKILL'}.md`;
  throw new ValidationError(`The URL must point to a raw .md or .zip file (got ${ct || 'no content type'})`);
}

// ---- Prompt-injection scan -----------------------------------------------

function lineAt(starts: number[], index: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function excerpt(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > MAX_SCAN_EXCERPT_CHARS ? `${t.slice(0, MAX_SCAN_EXCERPT_CHARS - 1)}…` : t;
}

/**
 * Deterministic prompt-injection scan of a skill body: every pattern hit with
 * its 1-based line, one finding per (rule, line). The whole body is matched,
 * not line by line, so a phrase split across a line break is still caught.
 */
export function scanSkillBody(body: string): Omit<SkillScan, 'scanned_at'> {
  const text = body.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const l of lines) {
    starts.push(offset);
    offset += l.length + 1;
  }
  const seen = new Set<string>();
  const findings: SkillScanFinding[] = [];
  for (const p of INJECTION_PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      const line = lineAt(starts, m.index ?? 0);
      const key = `${p.rule}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ rule: p.rule, label: p.label, line, excerpt: excerpt(lines[line - 1] ?? m[0]), source: 'pattern' });
    }
  }
  findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return {
    status: findings.length > 0 ? 'injection' : 'clean',
    method: 'pattern',
    findings: findings.slice(0, MAX_SCAN_FINDINGS),
  };
}

/** 1-based line of the first occurrence of `snippet` in `body`, or null. */
export function findLine(body: string, snippet: string): number | null {
  const needle = snippet.trim();
  if (!needle) return null;
  const i = body.indexOf(needle);
  return i < 0 ? null : body.slice(0, i).split('\n').length;
}

/** Columns that store a scan result (`skills.scan_*`). */
export function toScanColumns(scan: Omit<SkillScan, 'scanned_at'>, at: Date) {
  return {
    scanStatus: scan.status,
    scanMethod: scan.method,
    scanFindings: scan.findings,
    scannedAt: at,
  };
}

