import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse as parseEnv } from 'dotenv';
import {
  DEFAULT_CONTEXT_GLOB,
  LEGACY_CONTEXT_GLOB,
  legacyContextGlobWarning,
  loadConfig,
} from '../src/platform/config.js';

// "unset" is always built explicitly, never from process.env (server/.env leaks via dotenv/config).
const cfg = (CONTEXT_GLOB?: string) => loadConfig({ NODE_ENV: 'test', CONTEXT_GLOB }).contextGlob;
const exampleGlob = () => parseEnv(readFileSync(new URL('../.env.example', import.meta.url))).CONTEXT_GLOB;

describe('SPEC-02 CONTEXT_GLOB configuration', () => {
  it('AC-12: unset or empty CONTEXT_GLOB yields DEFAULT_CONTEXT_GLOB', () => {
    // contract: the applied pattern is one string equal to the documented default
    expect(cfg(undefined)).toBe(DEFAULT_CONTEXT_GLOB);
    expect(cfg('')).toBe(DEFAULT_CONTEXT_GLOB);
    expect(typeof cfg('')).toBe('string');
  });

  it('AC-15: the old SPEC-01 default yields one warning naming the new default and stays in effect', () => {
    const warning = legacyContextGlobWarning(LEGACY_CONTEXT_GLOB);
    // contract: exactly one warning string that names the new default
    expect(typeof warning).toBe('string');
    expect(warning).toContain(DEFAULT_CONTEXT_GLOB);
    // contract: the configured old pattern is kept unchanged
    expect(LEGACY_CONTEXT_GLOB).toBe('**/{specs,docs,insights}/**/*.md');
    expect(cfg(LEGACY_CONTEXT_GLOB)).toBe(LEGACY_CONTEXT_GLOB);
  });

  it('AC-15: the new default or a custom glob yields no warning', () => {
    // contract: no warning unless the value is exactly the old default
    expect(legacyContextGlobWarning(DEFAULT_CONTEXT_GLOB)).toBeNull();
    expect(legacyContextGlobWarning('**/*.md')).toBeNull();
    expect(legacyContextGlobWarning(cfg(''))).toBeNull();
  });

  it('AC-11: .env.example CONTEXT_GLOB equals the built-in default and the docs mention INSIGHTS.md', () => {
    // contract: a fresh .env copied from the example carries exactly the built-in default
    expect(exampleGlob()).toBe(DEFAULT_CONTEXT_GLOB);
    const envText = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    // contract: the example comment and the API reference both document INSIGHTS.md and the new default
    expect(envText).toContain('INSIGHTS.md');
    expect(readme).toContain('INSIGHTS.md');
    expect(readme).toContain(DEFAULT_CONTEXT_GLOB);
  });

  it('AC-16: CONTEXT_GLOB set to the .env.example value equals unset', () => {
    // contract: explicit default string behaves exactly like unset
    expect(cfg(exampleGlob())).toBe(cfg(''));
  });
});
