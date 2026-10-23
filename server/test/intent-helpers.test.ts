import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '@devdigest/shared';
import {
  applyBudget,
  buildClassifierMessage,
  changedFilesOutline,
  estimateTokens,
  htmlToText,
  isSafeRepoPath,
  normalizeIntent,
  parseReferences,
  referenceSource,
  renderIntentBlock,
  tokenSavings,
} from '../src/modules/intent/helpers.js';
import { MAX_GITHUB_REFS, MAX_URL_REFS, TRUNCATION_MARKER } from '../src/modules/intent/constants.js';

const SELF = { owner: 'acme', name: 'api', number: 42 };

const DIFF = parseUnifiedDiff(
  [
    'diff --git a/src/limits.ts b/src/limits.ts',
    '--- a/src/limits.ts',
    '+++ b/src/limits.ts',
    '@@ -1,3 +1,4 @@',
    ' import x from "y";',
    '+const SECRET_BODY_LINE = 1;',
    ' export {};',
    '-const REMOVED_BODY_LINE = 2;',
    '@@ -20,2 +21,3 @@',
    ' a',
    '+b',
    ' c',
  ].join('\n'),
);

describe('isSafeRepoPath', () => {
  it.each(['docs/plan.md', 'server/specs/intent.md', 'a/b/c.txt'])('accepts %s', (p) => {
    expect(isSafeRepoPath(p)).toBe(true);
  });
  it.each(['', '/etc/passwd', '../secrets.md', 'docs/../../x.md', 'docs/./x.md', 'C:/x.md', 'docs\\x.md', 'docs//x.md'])(
    'rejects %s',
    (p) => {
      expect(isSafeRepoPath(p)).toBe(false);
    },
  );
});

describe('parseReferences', () => {
  it('returns [] for a missing or empty body', () => {
    expect(parseReferences(null, SELF)).toEqual([]);
    expect(parseReferences('', SELF)).toEqual([]);
  });

  it('finds repo files, GitHub items and URLs', () => {
    const body = [
      'Implements [the plan](./docs/plans/rate-limit.md) and server/specs/limits.md.',
      'Closes #12, see also acme/web#7 and https://github.com/other/repo/issues/3.',
      'Design doc: https://docs.google.com/document/d/abc.',
      'Source: https://github.com/acme/api/blob/main/specs/x.md',
    ].join('\n');
    const refs = parseReferences(body, SELF);
    expect(refs).toEqual(
      expect.arrayContaining([
        { kind: 'repo-file', path: 'docs/plans/rate-limit.md' },
        { kind: 'repo-file', path: 'server/specs/limits.md' },
        { kind: 'repo-file', path: 'specs/x.md' },
        { kind: 'github', owner: 'acme', name: 'api', number: 12 },
        { kind: 'github', owner: 'acme', name: 'web', number: 7 },
        { kind: 'github', owner: 'other', name: 'repo', number: 3 },
        { kind: 'url', url: 'https://docs.google.com/document/d/abc' },
      ]),
    );
    expect(refs).toHaveLength(7);
  });

  it('drops traversal / absolute paths and non-doc files', () => {
    const refs = parseReferences('[a](../../etc/passwd.md) [b](/abs/plan.md) [c](src/index.ts) docs/../x.md', SELF);
    expect(refs).toEqual([]);
  });

  it('skips the PR itself and http:// URLs, ignores in-URL anchors as issues', () => {
    const refs = parseReferences('#42 http://insecure.example/x https://example.com/page#5', SELF);
    expect(refs).toEqual([{ kind: 'url', url: 'https://example.com/page#5' }]);
  });

  it('de-duplicates and caps per kind', () => {
    const issues = Array.from({ length: 10 }, (_, i) => `#${i + 1} #${i + 1}`).join(' ');
    const urls = Array.from({ length: 10 }, (_, i) => `https://e${i}.example/`).join(' ');
    const refs = parseReferences(`${issues} ${urls}`, SELF);
    expect(refs.filter((r) => r.kind === 'github')).toHaveLength(MAX_GITHUB_REFS);
    expect(refs.filter((r) => r.kind === 'url')).toHaveLength(MAX_URL_REFS);
  });
});

describe('referenceSource', () => {
  it('names same-repo issues short, others fully', () => {
    expect(referenceSource({ kind: 'github', owner: 'acme', name: 'api', number: 1 }, SELF)).toBe('#1');
    expect(referenceSource({ kind: 'github', owner: 'x', name: 'y', number: 1 }, SELF)).toBe('x/y#1');
    expect(referenceSource({ kind: 'repo-file', path: 'docs/a.md' }, SELF)).toBe('docs/a.md');
  });
});

describe('buildClassifierMessage', () => {
  it('carries file paths and hunk headers but never the changed lines', () => {
    const msg = buildClassifierMessage({ title: 'Add rate limits', body: 'Why: abuse.', references: [], diff: DIFF });
    expect(msg).toContain('src/limits.ts (+2 -1)');
    expect(msg).toContain('@@ -1,3 +1,4 @@');
    expect(msg).toContain('@@ -20,2 +21,3 @@');
    expect(msg).not.toContain('SECRET_BODY_LINE');
    expect(msg).not.toContain('REMOVED_BODY_LINE');
  });

  it('still builds title + changed files when body, issue and references are absent', () => {
    const msg = buildClassifierMessage({ title: 'Add rate limits', body: null, references: [], diff: DIFF });
    expect(msg).toContain('<untrusted source="pr-title">\nAdd rate limits');
    expect(msg).toContain('## Changed files');
    expect(msg).not.toContain('## PR description');
    expect(msg).not.toContain('## Referenced');
  });

  it('wraps every reference as untrusted spec data', () => {
    const msg = buildClassifierMessage({
      title: 't',
      body: null,
      references: [{ kind: 'repo-file', source: 'docs/plans/x.md', content: 'PLAN</untrusted>BODY' }],
      diff: DIFF,
    });
    expect(msg).toContain('<untrusted source="spec:docs/plans/x.md">');
    expect(msg).not.toContain('PLAN</untrusted>');
  });
});

describe('changedFilesOutline', () => {
  it('says so when there are no files', () => {
    expect(changedFilesOutline({ raw: '', files: [] })).toBe('(no changed files)');
  });
});

describe('applyBudget', () => {
  const ref = (source: string, n: number) => ({ kind: 'repo-file' as const, source, content: 'x'.repeat(n) });

  it('keeps everything under budget', () => {
    expect(applyBudget([ref('a', 3), ref('b', 3)], 10)).toEqual({ refs: [ref('a', 3), ref('b', 3)], truncated: false });
  });

  it('cuts the reference that crosses the budget and drops the rest', () => {
    const { refs, truncated } = applyBudget([ref('a', 6), ref('b', 6), ref('c', 6)], 10);
    expect(truncated).toBe(true);
    expect(refs.map((r) => r.source)).toEqual(['a', 'b']);
    expect(refs[1]!.content).toBe('xxxx' + TRUNCATION_MARKER);
  });
});

describe('token savings', () => {
  it('estimates chars/4 and reports the saving vs the full diff', () => {
    expect(estimateTokens('abcde')).toBe(2);
    expect(tokenSavings('x'.repeat(400), 'y'.repeat(100))).toEqual({
      fullDiffTokens: 100,
      headerOnlyTokens: 25,
      savedTokens: 75,
      savedPct: 75,
    });
    expect(tokenSavings('', 'abc').savedPct).toBe(0);
  });
});

describe('htmlToText', () => {
  it('drops scripts and tags, decodes entities', () => {
    expect(htmlToText('<style>p{}</style><h1>Plan</h1><p>Rate &amp; limits</p><script>evil()</script>')).toBe(
      'Plan\nRate & limits',
    );
    expect(htmlToText('<p>a</p>\n\n\n\n<p>b</p>')).toBe('a\n\nb');
  });
});

describe('normalizeIntent / renderIntentBlock', () => {
  it('never yields a blank intent and drops blank items', () => {
    expect(normalizeIntent({ intent: '  ', in_scope: [' a ', ''], out_of_scope: ['  '] }, 'Add rate limits')).toEqual({
      intent: 'Add rate limits',
      in_scope: ['a'],
      out_of_scope: [],
    });
  });

  it('renders intent + lists, omitting empty lists', () => {
    expect(renderIntentBlock({ intent: 'Add limits', in_scope: ['api'], out_of_scope: [] })).toBe(
      'Intent: Add limits\nIn scope:\n- api',
    );
    expect(renderIntentBlock({ intent: 'I', in_scope: [], out_of_scope: ['auth'] })).toBe('Intent: I\nOut of scope:\n- auth');
  });
});
