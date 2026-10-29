import { describe, it, expect } from 'vitest';
import {
  parseUnifiedDiff,
  type BriefModelOutput,
  type PrBlastRadius,
  type Risk,
} from '@devdigest/shared';
import { TiktokenTokenizer } from '../src/adapters/tokenizer/index.js';
import {
  buildBriefMessages,
  fileStatsFromDiff,
  fileStatsFromPrFiles,
  fitBudget,
  isStale,
  postValidate,
  validPathSet,
  withPatchlessFiles,
  type BriefSections,
  type FileStat,
} from '../src/modules/brief/helpers.js';

// ---------- fixtures ----------

const stat = (path: string, newR: [number, number][] = [], oldR: [number, number][] = []): FileStat => ({
  path,
  additions: 3,
  deletions: 1,
  newRanges: newR.map(([from, to]) => ({ from, to })),
  oldRanges: oldR.map(([from, to]) => ({ from, to })),
});

const blast = (over: Partial<PrBlastRadius> = {}): PrBlastRadius => ({
  pr_id: 'pr-1',
  degraded: false,
  reason: null,
  summary: 'BLAST_SUMMARY_FACT',
  changed_symbols: [{ name: 'limitFn', file: 'src/a.ts', kind: 'function' }],
  downstream: [
    {
      symbol: 'limitFn',
      callers: [{ name: 'handler', file: 'src/caller.ts', line: 40 }],
      endpoints_affected: ['GET /api/limited'],
      crons_affected: ['nightly-reset'],
    },
  ],
  ...over,
});

const risk = (over: Partial<Risk> = {}): Risk => ({
  kind: 'security',
  title: 'T',
  explanation: 'E',
  severity: 'high',
  file_refs: ['src/a.ts'],
  ...over,
});

const out = (over: Partial<BriefModelOutput> = {}): BriefModelOutput => ({
  summary: 'S',
  risks: [],
  review_focus: [],
  ...over,
});

const FILES: FileStat[] = [
  stat('src/a.ts', [[10, 20], [40, 41]]),
  stat('src/gone.ts', [], [[1, 5]]), // deleted: old side only
  stat('src/renamed.ts'), // rename/binary: no hunks
];

describe('isStale', () => {
  it('AC-5: stale exactly when the stored head_sha differs from the current one', () => {
    // contract: differing SHA -> stale; equal -> fresh
    expect(isStale({ head_sha: 'aaa' }, 'bbb')).toBe(true);
    expect(isStale({ head_sha: 'aaa' }, 'aaa')).toBe(false);
  });
});

describe('hunk / file stats', () => {
  it('AC-29: stats from a patch keep hunk numbers only; ",0" sides give no range', () => {
    // contract: ranges come from @@ headers; a pure addition has no old-side range
    const [f] = fileStatsFromPrFiles([
      { path: 'src/a.ts', additions: 2, deletions: 0, patch: '@@ -0,0 +1,2 @@ ctx\n+x\n+y\n@@ -10 +12,3 @@\n z' },
    ]);
    expect(f!.newRanges).toEqual([{ from: 1, to: 2 }, { from: 12, to: 14 }]);
    expect(f!.oldRanges).toEqual([{ from: 10, to: 10 }]);
  });
});

describe('withPatchlessFiles', () => {
  it('AC-29: merges only patchless rows missing from the diff; rows with a patch are ignored', () => {
    // contract: a binary/renamed row (no patch) becomes a valid bare path;
    // a row WITH a patch the diff does not list is stale and must not become valid
    const base = [stat('src/a.ts', [[1, 2]])];
    const merged = withPatchlessFiles(base, [
      { path: 'src/a.ts', additions: 1, deletions: 1, patch: null }, // already known
      { path: 'img/logo.png', additions: 0, deletions: 0, patch: null },
      { path: 'src/renamed.ts', additions: 0, deletions: 0 },
      { path: 'src/stale.ts', additions: 5, deletions: 0, patch: '@@ -1 +1 @@' },
    ]);
    expect(merged.map((f) => f.path)).toEqual(['src/a.ts', 'img/logo.png', 'src/renamed.ts']);
    expect(merged[1]).toMatchObject({ newRanges: [], oldRanges: [] });
    // contract: nothing to add -> same list
    expect(withPatchlessFiles(base, [])).toEqual(base);
  });
});

describe('validPathSet', () => {
  it('AC-29: changed files plus caller files when blast is available; exact strings only', () => {
    // contract: path valid iff exactly a changed file or a caller file
    const set = validPathSet(FILES, blast());
    expect(set.has('src/a.ts')).toBe(true);
    expect(set.has('src/caller.ts')).toBe(true);
    expect(set.has('./src/a.ts')).toBe(false);
    expect(set.has('SRC/A.TS')).toBe(false);
    expect(set.has('src/a.ts/')).toBe(false);
    expect(set.has('src/invented.ts')).toBe(false);
  });

  it('AC-29: with a degraded (or missing) blast map caller files are invalid', () => {
    // contract: degraded blast contributes nothing
    expect(validPathSet(FILES, blast({ degraded: true, reason: 'index_partial' })).has('src/caller.ts')).toBe(false);
    expect(validPathSet(FILES, null).has('src/caller.ts')).toBe(false);
    expect(validPathSet(FILES, null).has('src/a.ts')).toBe(true);
  });

  it('AC-29: postValidate honours a degraded map (caller-file focus dropped) and a healthy one (kept)', () => {
    const o = out({ review_focus: [{ file: 'src/caller.ts', line: 40, reason: 'r' }] });
    expect(postValidate(o, FILES, blast()).review_focus).toHaveLength(1);
    expect(postValidate(o, FILES, blast({ degraded: true, reason: 'no_data' })).review_focus).toHaveLength(0);
  });
});

describe('postValidate: review focus', () => {
  it('AC-30: a focus item on an invented / non-exact path is dropped', () => {
    const o = out({
      review_focus: [
        { file: 'src/invented.ts', line: 3, reason: 'r' },
        { file: './src/a.ts', line: 12, reason: 'r' },
        { file: 'src/A.ts', line: 12, reason: 'r' },
        { file: 'src/a.ts', line: 12, reason: 'real' },
      ],
    });
    const res = postValidate(o, FILES, null);
    expect(res.review_focus).toEqual([{ file: 'src/a.ts', line: 12, reason: 'real' }]);
    expect(res.dropped.review_focus).toBe(3);
  });

  it('AC-31: a line outside every hunk range is dropped; inside (incl. boundaries) is kept', () => {
    const o = out({
      review_focus: [
        { file: 'src/a.ts', line: 999, reason: 'r' },
        { file: 'src/a.ts', line: 9, reason: 'r' },
        { file: 'src/a.ts', line: 10, reason: 'lo' },
        { file: 'src/a.ts', line: 20, reason: 'hi' },
        { file: 'src/a.ts', line: 41, reason: 'second hunk' },
      ],
    });
    expect(postValidate(o, FILES, null).review_focus.map((i) => i.line)).toEqual([10, 20, 41]);
  });

  it('AC-31: a deleted file (no new-side lines) is checked against old-side ranges', () => {
    const o = out({
      review_focus: [
        { file: 'src/gone.ts', line: 3, reason: 'old side' },
        { file: 'src/gone.ts', line: 50, reason: 'outside' },
      ],
    });
    expect(postValidate(o, FILES, null).review_focus).toEqual([{ file: 'src/gone.ts', line: 3, reason: 'old side' }]);
  });

  it('AC-31: a caller file not in the diff keeps only its listed caller lines', () => {
    const o = out({
      review_focus: [
        { file: 'src/caller.ts', line: 40, reason: 'listed caller line' },
        { file: 'src/caller.ts', line: 41, reason: 'other line' },
      ],
    });
    expect(postValidate(o, FILES, blast()).review_focus).toEqual([
      { file: 'src/caller.ts', line: 40, reason: 'listed caller line' },
    ]);
  });

  it('AC-31: a rename/binary file with no hunks drops its focus items', () => {
    const o = out({ review_focus: [{ file: 'src/renamed.ts', line: 1, reason: 'r' }] });
    expect(postValidate(o, FILES, null).review_focus).toEqual([]);
  });

  it('AC-35: duplicate focus items (same file+line) keep the first, preserving order', () => {
    const o = out({
      review_focus: [
        { file: 'src/a.ts', line: 41, reason: 'first' },
        { file: 'src/a.ts', line: 12, reason: 'second' },
        { file: 'src/a.ts', line: 41, reason: 'dup of first' },
      ],
    });
    expect(postValidate(o, FILES, null).review_focus).toEqual([
      { file: 'src/a.ts', line: 41, reason: 'first' },
      { file: 'src/a.ts', line: 12, reason: 'second' },
    ]);
  });

  it('AC-36: at most 8 focus items, first ones in model order; dropped counts invalid + over-cap', () => {
    const valid = Array.from({ length: 10 }, (_, i) => ({ file: 'src/a.ts', line: 10 + i, reason: `r${i}` }));
    const o = out({ review_focus: [{ file: 'nope.ts', line: 1, reason: 'bad' }, ...valid] });
    const res = postValidate(o, FILES, null);
    expect(res.review_focus.map((i) => i.reason)).toEqual(valid.slice(0, 8).map((i) => i.reason));
    // 11 in, 8 kept -> 1 invalid + 2 over-cap
    expect(res.dropped.review_focus).toBe(3);
  });
});

describe('postValidate: risk refs', () => {
  it('AC-32: path / path:N / path:N-M forms with a valid path are kept; invalid path and N>M removed', () => {
    const o = out({
      risks: [
        risk({
          file_refs: ['src/a.ts:12-18', 'src/a.ts', 'src/a.ts:15', 'src/x.ts:3', 'src/a.ts:9-3', 'src/a.ts:0'],
        }),
      ],
    });
    expect(postValidate(o, FILES, null).risks[0]!.file_refs).toEqual(['src/a.ts:12-18', 'src/a.ts', 'src/a.ts:15']);
  });

  it('AC-33: a line part outside every hunk degrades to the bare path', () => {
    const o = out({ risks: [risk({ file_refs: ['src/a.ts:400-410'] })] });
    expect(postValidate(o, FILES, null).risks[0]!.file_refs).toEqual(['src/a.ts']);
  });

  it('AC-33: a caller-file ref off its caller line degrades to the bare path; on the line it is kept', () => {
    const o = out({ risks: [risk({ file_refs: ['src/caller.ts:40', 'src/caller.ts:99'] })] });
    // both refs: first kept as-is, second degraded to bare -> distinct entries
    expect(postValidate(o, FILES, blast()).risks[0]!.file_refs).toEqual(['src/caller.ts:40', 'src/caller.ts']);
  });

  it('AC-33 / AC-31: a rename/binary file with no hunks keeps the bare path for a risk ref', () => {
    const o = out({ risks: [risk({ file_refs: ['src/renamed.ts:5'] })] });
    expect(postValidate(o, FILES, null).risks[0]!.file_refs).toEqual(['src/renamed.ts']);
  });

  it('AC-34: a risk with no valid ref left is dropped and counted', () => {
    const o = out({
      risks: [risk({ title: 'ghost', file_refs: ['src/invented.ts:1', 'src/a.ts:9-3'] }), risk({ title: 'real' })],
    });
    const res = postValidate(o, FILES, null);
    expect(res.risks.map((r) => r.title)).toEqual(['real']);
    expect(res.dropped.risks).toBe(1);
  });

  it('AC-35: duplicate refs within a risk are removed, keeping the first and the model order', () => {
    const o = out({
      risks: [risk({ file_refs: ['src/a.ts:12-18', 'src/gone.ts', 'src/a.ts:12-18', 'src/gone.ts'] })],
    });
    expect(postValidate(o, FILES, null).risks[0]!.file_refs).toEqual(['src/a.ts:12-18', 'src/gone.ts']);
  });

  it('AC-36: 10 valid risks -> 8 stored in model order; dropped.risks = invalid + over-cap', () => {
    const valid = Array.from({ length: 10 }, (_, i) => risk({ title: `r${i}` }));
    const res10 = postValidate(out({ risks: valid }), FILES, null);
    expect(res10.risks.map((r) => r.title)).toEqual(valid.slice(0, 8).map((r) => r.title));
    expect(res10.dropped.risks).toBe(2);

    const withInvalid = postValidate(
      out({ risks: [risk({ title: 'bad', file_refs: ['x.ts'] }), ...valid] }),
      FILES,
      null,
    );
    // 11 in, 8 kept -> 1 invalid + 2 over-cap
    expect(withInvalid.dropped.risks).toBe(3);
    expect(withInvalid.risks).toHaveLength(8);
  });

  it('AC-37 (pure side): when everything is invented, the lists are empty and dropped counts everything', () => {
    const o = out({
      risks: [risk({ file_refs: ['/etc/passwd'] })],
      review_focus: [{ file: '/etc/passwd', line: 1, reason: 'r' }],
    });
    expect(postValidate(o, FILES, null)).toEqual({ risks: [], review_focus: [], dropped: { risks: 1, review_focus: 1 } });
  });
});

// ---------- prompt assembly ----------

const MARKERS = ['PLUS_MARKER', 'MINUS_MARKER', 'CTX_MARKER', 'HUNKFN_MARKER'];
const MARKED_PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -10,3 +10,3 @@ function HUNKFN_MARKER()',
  ' CTX_MARKER',
  '-MINUS_MARKER',
  '+PLUS_MARKER',
  ' tail',
].join('\n');

function sections(over: Partial<BriefSections> = {}): BriefSections {
  return {
    system: 'SYSTEM PROMPT',
    title: 'TITLE_FACT',
    description: 'DESCRIPTION_FACT',
    intent: { intent: 'INTENT_FACT', in_scope: ['IN_SCOPE_FACT'], out_of_scope: ['OUT_SCOPE_FACT'] },
    blast: blast(),
    files: [stat('src/a.ts', [[10, 20]]), stat('src/b.ts', [[5, 5]])],
    issues: [{ source: '#12', text: 'ISSUE_FACT' }],
    documents: [{ path: 'docs/plan.md', text: 'DOC_FACT' }],
    ...over,
  };
}

const allText = (s: BriefSections) =>
  buildBriefMessages(s)
    .map((m) => m.content)
    .join('\n');

describe('buildBriefMessages', () => {
  it('AC-10: the message contains each fact of the fixture PR', () => {
    // contract: title, description, intent, blast summary/symbols/callers/endpoints/crons,
    // per-file path+additions+deletions+ranges, issue text and documents all reach the model
    const text = allText(sections());
    for (const fact of [
      'TITLE_FACT',
      'DESCRIPTION_FACT',
      'INTENT_FACT',
      'IN_SCOPE_FACT',
      'OUT_SCOPE_FACT',
      'BLAST_SUMMARY_FACT',
      'limitFn',
      'src/caller.ts:40',
      'GET /api/limited',
      'nightly-reset',
      'src/a.ts',
      '+3 -1',
      '10-20',
      'ISSUE_FACT',
      'DOC_FACT',
      'docs/plan.md',
    ]) {
      expect(text, fact).toContain(fact);
    }
  });

  it('AC-11: no hunk body (+, -, context, or @@ function-context text) is ever in a message', () => {
    // contract: only numeric hunk ranges are sent; markers placed in every hunk line kind must be absent
    const fromDiff = fileStatsFromDiff(parseUnifiedDiff(MARKED_PATCH));
    const fromPatch = fileStatsFromPrFiles([
      { path: 'src/a.ts', additions: 1, deletions: 1, patch: MARKED_PATCH.split('\n').slice(3).join('\n') },
    ]);
    for (const files of [fromDiff, fromPatch]) {
      const text = allText(sections({ files }));
      expect(text).toContain('10-12'); // the ranges did arrive
      for (const m of MARKERS) expect(text, m).not.toContain(m);
    }
  });

  it('AC-10: a missing intent / blast / description / issues / documents contributes no section', () => {
    const text = allText(sections({ intent: null, blast: null, description: null, issues: [], documents: [] }));
    expect(text).not.toContain('INTENT_FACT');
    expect(text).not.toContain('BLAST_SUMMARY_FACT');
    expect(text).toContain('TITLE_FACT');
  });
});

// ---------- budget ----------

describe('fitBudget (real tiktoken)', () => {
  it('AC-17: an oversized fixture ends within 8,000 tokens counted over all messages', () => {
    // contract: the whole input (system + user) stays <= 8,000 tiktoken tokens
    const tk = new TiktokenTokenizer();
    const count = (s: string) => tk.count(s);
    const big = sections({
      description: 'description words '.repeat(3000),
      issues: [{ source: '#12', text: 'issue words '.repeat(3000) }],
      documents: Array.from({ length: 12 }, (_, i) => ({ path: `docs/d${i}.md`, text: `doc ${i} words `.repeat(2000) })),
    });
    const before = buildBriefMessages(big).reduce((n, m) => n + count(m.content), 0);
    expect(before).toBeGreaterThan(8000);

    const fit = fitBudget(big, count, 8000);
    expect('tooLarge' in fit).toBe(false);
    if ('tooLarge' in fit) return;
    const after = fit.messages.reduce((n, m) => n + count(m.content), 0);
    expect(after).toBeLessThanOrEqual(8000);
    expect(fit.inputTokens).toBeLessThanOrEqual(8000);
    expect(fit.trimmed.length).toBeGreaterThan(0);
  });
});

describe('fitBudget (deterministic counter)', () => {
  // 1 char = 1 token keeps the arithmetic obvious
  const count = (s: string) => s.length;
  const base = sections({ description: 'd'.repeat(100), issues: [{ source: '#1', text: 'i'.repeat(100) }], documents: [] });
  const baseSize = buildBriefMessages(base).reduce((n, m) => n + count(m.content), 0);
  const doc = (n: number, size: number) => ({ path: `docs/${n}.md`, text: `${n}`.repeat(size) });

  it('AC-18: when the input already fits nothing is trimmed', () => {
    const fit = fitBudget(base, count, baseSize + 10);
    expect('tooLarge' in fit).toBe(false);
    if ('tooLarge' in fit) return;
    expect(fit.trimmed).toEqual([]);
    expect(fit.sections).toEqual(base);
  });

  it('AC-18: step 1 only — documents are dropped from the end; issue text and description stay whole', () => {
    const docs = [doc(1, 500), doc(2, 500), doc(3, 500)];
    const s = { ...base, documents: docs };
    const budget = baseSize + 1500; // room for roughly the first doc block only
    const fit = fitBudget(s, count, budget);
    if ('tooLarge' in fit) throw new Error('unexpected tooLarge');
    // contract: later documents go first; the kept ones are a prefix of the original order
    expect(fit.sections.documents.length).toBeLessThan(3);
    expect(fit.sections.documents).toEqual(docs.slice(0, fit.sections.documents.length));
    expect(fit.trimmed.map((t) => t.input)).toEqual(['specs']);
    expect(fit.trimmed[0]!.tokens).toBeGreaterThan(0);
    expect(fit.sections.issues).toEqual(base.issues);
    expect(fit.sections.description).toBe(base.description);
    expect(fit.inputTokens).toBeLessThanOrEqual(budget);
  });

  it('AC-18: step 2 only after all documents are gone — the issue text is shortened, description intact', () => {
    const s = { ...base, documents: [doc(1, 300)], issues: [{ source: '#1', text: 'i'.repeat(2000) }] };
    const budget = baseSize + 400; // docs alone cannot make room: the 2000-char issue must shrink
    const fit = fitBudget(s, count, budget);
    if ('tooLarge' in fit) throw new Error('unexpected tooLarge');
    expect(fit.sections.documents).toEqual([]);
    expect(fit.trimmed.map((t) => t.input)).toEqual(['specs', 'linked_issue']);
    expect(fit.sections.issues[0]!.text.length).toBeLessThan(2000);
    expect(fit.sections.description).toBe(base.description);
    expect(fit.inputTokens).toBeLessThanOrEqual(budget);
  });

  it('AC-18: step 3 only when documents and issues were not enough — the description is shortened last', () => {
    const s = { ...base, documents: [doc(1, 300)], issues: [{ source: '#1', text: 'i'.repeat(300) }], description: 'd'.repeat(3000) };
    const budget = baseSize + 100;
    const fit = fitBudget(s, count, budget);
    if ('tooLarge' in fit) throw new Error('unexpected tooLarge');
    expect(fit.trimmed.map((t) => t.input)).toEqual(['specs', 'linked_issue', 'description']);
    expect(fit.sections.description!.length).toBeLessThan(3000);
    expect(fit.inputTokens).toBeLessThanOrEqual(budget);
  });

  it('AC-18: with no documents and no linked issue, an overflow shortens only the description', () => {
    const s = { ...base, issues: [], description: 'd'.repeat(3000) };
    const budget = baseSize - 100 + 100;
    const fit = fitBudget(s, count, budget);
    if ('tooLarge' in fit) throw new Error('unexpected tooLarge');
    expect(fit.trimmed.map((t) => t.input)).toEqual(['description']);
    expect(fit.inputTokens).toBeLessThanOrEqual(budget);
  });

  it('AC-18: intent, blast, title and file stats are intact after every trim', () => {
    const s = { ...base, documents: [doc(1, 2000)], issues: [{ source: '#1', text: 'i'.repeat(2000) }], description: 'd'.repeat(2000) };
    const fit = fitBudget(s, count, baseSize);
    if ('tooLarge' in fit) throw new Error('unexpected tooLarge');
    expect(fit.trimmed.length).toBeGreaterThan(0);
    expect(fit.sections.intent).toEqual(s.intent);
    expect(fit.sections.blast).toEqual(s.blast);
    expect(fit.sections.files).toEqual(s.files);
    expect(fit.sections.title).toBe(s.title);
    const text = fit.messages.map((m) => m.content).join('\n');
    for (const fact of ['INTENT_FACT', 'BLAST_SUMMARY_FACT', 'src/caller.ts:40', 'src/a.ts', 'src/b.ts']) {
      expect(text, fact).toContain(fact);
    }
  });

  it('AC-20 (pure side): untrimmable inputs alone over the budget -> tooLarge, never trimmed', () => {
    const many = Array.from({ length: 2000 }, (_, i) => stat(`src/file-${i}.ts`, [[1, 50]]));
    const fit = fitBudget(sections({ files: many }), (s) => Math.ceil(s.length / 4), 8000);
    expect('tooLarge' in fit && fit.tooLarge).toBe(true);
    if ('tooLarge' in fit) expect(fit.untrimmableTokens).toBeGreaterThan(8000);
  });
});
