/**
 * Config files sampled before the ranked source files. They carry conventions
 * that are enforced by tooling (lint rules, strictness, formatting). Missing
 * ones are skipped; the list is a wish-list, not a requirement.
 */
export const CONFIG_FILES = [
  'package.json',
  'tsconfig.json',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  '.prettierrc.cjs',
  'prettier.config.js',
  'prettier.config.mjs',
  '.editorconfig',
] as const;

/** Top-ranked source files taken from repo-intel (`getConventionSamples`). */
export const SAMPLE_FILES = 12;

/** Each file is cut to its first lines — line numbers stay 1:1 with the file. */
export const MAX_FILE_LINES = 300;
export const MAX_FILE_CHARS = 12_000;
/** Whole sample budget; files past it are left out, not cut mid-way. */
export const MAX_SAMPLE_CHARS = 90_000;

/** The model is asked for at most this many; extra ones are ignored. */
export const MAX_CANDIDATES = 12;

/** A snippet needs this many non-space chars to identify code (`}` identifies nothing). */
export const MIN_SNIPPET_CHARS = 8;
/** How far (in lines) the found snippet may sit from the line the model cited. */
export const LINE_TOLERANCE = 3;
/** Longest evidence kept per candidate. */
export const MAX_EVIDENCE_LINES = 20;

export const LLM_TEMPERATURE = 0.1;

/** Default name of the skill the accepted conventions merge into. */
export const SKILL_NAME = 'repo-conventions';
export const SKILL_CHANGE_NOTE = 'Regenerated from accepted conventions';
/** Mirrors the skills module's body limit — a longer draft drops its code blocks. */
export const MAX_SKILL_BODY_CHARS = 20_000;
