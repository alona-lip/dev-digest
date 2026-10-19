import { describe, it, expect } from 'vitest';
import type { ConventionCandidate } from '@devdigest/shared';
import {
  buildSample,
  buildSkillDraft,
  clampConfidence,
  dedent,
  dedupeRules,
  groundCandidates,
  renderFile,
  ruleKey,
  truncateFile,
  verifyEvidence,
} from '../src/modules/conventions/helpers.js';
import { MAX_FILE_LINES, SKILL_NAME } from '../src/modules/conventions/constants.js';
import type { ExtractedConvention } from '../src/modules/conventions/schema.js';

const USERS_TS = [
  "import { db } from '../db';", // 1
  '', // 2
  'export async function getUser(id: string) {', // 3
  '  const user = await db.users.find(id);', // 4
  '  const posts = await db.posts.findMany({ userId: id });', // 5
  '  return { user, posts };', // 6
  '}', // 7
].join('\n');

const files = new Map([['src/api/users.ts', USERS_TS]]);

const candidate = (over: Partial<ExtractedConvention['evidence']> = {}, rule = 'Use async/await'): ExtractedConvention => ({
  rule,
  category: 'ASYNC',
  confidence: 0.9,
  evidence: {
    path: 'src/api/users.ts',
    start_line: 4,
    end_line: 5,
    snippet: 'const user = await db.users.find(id);\nconst posts = await db.posts.findMany({ userId: id });',
    ...over,
  },
});

describe('sampling', () => {
  it('renders a 1-based gutter under a file header', () => {
    const out = renderFile({ path: 'a.ts', content: 'x\ny' });
    expect(out).toBe('=== FILE: a.ts ===\n1 | x\n2 | y');
  });

  it('truncates by lines, keeping line N as line N', () => {
    const long = Array.from({ length: MAX_FILE_LINES + 50 }, (_, i) => `line ${i + 1}`).join('\n');
    const cut = truncateFile(long).split('\n');
    expect(cut).toHaveLength(MAX_FILE_LINES);
    expect(cut[9]).toBe('line 10');
  });

  it('skips empty files and leaves out a whole file once the budget is spent', () => {
    const sample = buildSample(
      [
        { path: 'a.ts', content: 'const a = 1;' },
        { path: 'empty.ts', content: '   \n' },
        { path: 'big.ts', content: 'x'.repeat(500) },
        { path: 'c.ts', content: 'const c = 3;' },
      ],
      120,
    );
    expect(sample.files.map((f) => f.path)).toEqual(['a.ts', 'c.ts']);
    expect(sample.text).toContain('=== FILE: c.ts ===');
    expect(sample.text).not.toContain('big.ts');
  });
});

describe('verifyEvidence — the code gate', () => {
  it('keeps a citation that matches, and slices the snippet from the file (dedented)', () => {
    const r = verifyEvidence(candidate(), files);
    expect(r).toEqual({
      ok: true,
      value: expect.objectContaining({
        evidencePath: 'src/api/users.ts',
        evidenceStartLine: 4,
        evidenceEndLine: 5,
        evidenceSnippet: 'const user = await db.users.find(id);\nconst posts = await db.posts.findMany({ userId: id });',
      }),
    });
  });

  it('drops a file the model was not shown', () => {
    expect(verifyEvidence(candidate({ path: 'src/other.ts' }), files)).toEqual({ ok: false, reason: 'file_not_sampled' });
  });

  it('accepts ./ and leading-slash forms of a sampled path', () => {
    expect(verifyEvidence(candidate({ path: './src/api/users.ts' }), files).ok).toBe(true);
    expect(verifyEvidence(candidate({ path: '/src/api/users.ts' }), files).ok).toBe(true);
  });

  it('drops a line outside the file', () => {
    expect(verifyEvidence(candidate({ start_line: 99, end_line: 100 }), files)).toEqual({
      ok: false,
      reason: 'line_out_of_range',
    });
    expect(verifyEvidence(candidate({ start_line: 0 }), files)).toEqual({ ok: false, reason: 'line_out_of_range' });
  });

  it('drops a snippet that is too short to identify code', () => {
    expect(verifyEvidence(candidate({ start_line: 7, end_line: 7, snippet: '}' }), files)).toEqual({
      ok: false,
      reason: 'snippet_too_short',
    });
  });

  it('drops an invented snippet', () => {
    expect(verifyEvidence(candidate({ snippet: 'const user = await fetchUser(id).then(handle);' }), files)).toEqual({
      ok: false,
      reason: 'snippet_not_found',
    });
  });

  it('corrects a small line drift to where the snippet really is', () => {
    const r = verifyEvidence(candidate({ start_line: 2, end_line: 3 }), files);
    expect(r.ok && [r.value.evidenceStartLine, r.value.evidenceEndLine]).toEqual([4, 5]);
  });

  it('drops a snippet that exists but far from the cited line', () => {
    const far = [...Array(20).fill('// filler'), USERS_TS].join('\n');
    const r = verifyEvidence(candidate({ start_line: 2 }), new Map([['src/api/users.ts', far]]));
    expect(r).toEqual({ ok: false, reason: 'snippet_not_found' });
  });

  it('ignores a gutter the model copied into the snippet', () => {
    const r = verifyEvidence(candidate({ snippet: '4 |   const user = await db.users.find(id);' }), files);
    expect(r.ok && r.value.evidenceEndLine).toBe(4);
  });

  it('clamps confidence into 0..1', () => {
    expect(clampConfidence(1.7)).toBe(1);
    expect(clampConfidence(-1)).toBe(0);
    expect(clampConfidence(Number.NaN)).toBe(0.5);
  });

  it('groundCandidates splits kept from dropped with a reason', () => {
    const out = groundCandidates(
      [candidate(), candidate({ path: 'nope.ts' }, 'Invented rule')],
      [{ path: 'src/api/users.ts', content: USERS_TS }],
    );
    expect(out.kept).toHaveLength(1);
    expect(out.dropped).toEqual([{ rule: 'Invented rule', reason: 'file_not_sampled' }]);
  });

  it('dedent removes only the shared indent', () => {
    expect(dedent('    a\n      b\n\n    c')).toBe('a\n  b\n\nc');
  });
});

describe('dedupeRules', () => {
  it('treats case, punctuation and backticks as the same rule', () => {
    expect(ruleKey('Always use `async/await`, never .then()!')).toBe(ruleKey('always use async/await never .then'));
  });

  it('drops rules already on the list (accepted or rejected) and repeats inside the batch, keeping the most confident', () => {
    const { fresh, duplicates } = dedupeRules(
      [
        { rule: 'Use async/await', confidence: 0.6 },
        { rule: 'use async/await.', confidence: 0.9 },
        { rule: 'Redis via the singleton', confidence: 0.8 },
        { rule: 'New rule', confidence: 0.7 },
      ],
      ['Redis via the singleton'],
    );
    expect(fresh.map((f) => [f.rule, f.confidence])).toEqual([
      ['use async/await.', 0.9],
      ['New rule', 0.7],
    ]);
    expect(duplicates).toBe(2);
  });
});

describe('buildSkillDraft', () => {
  const accepted: ConventionCandidate[] = [
    {
      id: 'c1',
      repo_id: 'r1',
      category: 'ASYNC',
      rule: 'Always use async/await instead of .then() chains',
      evidence_path: 'src/api/users.ts',
      evidence_start_line: 23,
      evidence_end_line: 31,
      evidence_snippet: 'const user = await db.users.find(id);',
      confidence: 0.91,
      status: 'ACCEPTED',
      created_at: '2026-10-19T00:00:00.000Z',
    },
  ];

  it('builds the repo-conventions skill: header, one section per rule, cited evidence', () => {
    const draft = buildSkillDraft('payments-api', accepted);
    expect(draft.name).toBe(SKILL_NAME);
    expect(draft.type).toBe('convention');
    expect(draft.enabled).toBe(true);
    expect(draft.description).toMatch(/^Use when reviewing changes to payments-api/);
    expect(draft.body).toContain('# repo-conventions');
    expect(draft.body).toContain('House conventions for `payments-api`');
    expect(draft.body).toContain('## Always use async/await instead of .then() chains');
    expect(draft.body).toContain('Detected in `src/api/users.ts:23-31`:');
    expect(draft.body).toContain('```ts\nconst user = await db.users.find(id);\n```');
  });

  it('drops the code blocks when the body would exceed the skill limit', () => {
    const big = { ...accepted[0]!, evidence_snippet: 'x'.repeat(25_000) };
    const draft = buildSkillDraft('payments-api', [big]);
    expect(draft.body).not.toContain('```');
    expect(draft.body).toContain('Detected in `src/api/users.ts:23-31`.');
  });
});
