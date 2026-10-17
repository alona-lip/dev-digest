import { unzipSync } from 'fflate';
import { SkillType, type IgnoredFileReason, type SkillImportPreview } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
import type { Skill, SkillVersion } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import {
  BINARY_EXT,
  EXECUTABLE_EXT,
  MAX_ARCHIVE_ENTRIES,
  MAX_BODY_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_IMPORT_FILE_BYTES,
  MAX_NAME_CHARS,
  MAX_SKILL_MD_BYTES,
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

/** Build the (unsaved) import preview from an uploaded file. `name_conflict` is set by the service. */
export function buildImportPreview(
  filename: string,
  bytes: Uint8Array,
): Omit<SkillImportPreview, 'name_conflict'> {
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
