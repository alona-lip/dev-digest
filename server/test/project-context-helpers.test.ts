import { describe, it, expect } from 'vitest';
import {
  applyBudget,
  buildEffectiveSet,
  countUsage,
  docTypeOf,
  toAttachmentDocs,
  toListPage,
} from '../src/modules/project-context/helpers.js';

describe('docTypeOf', () => {
  it('AC-3: type is the deepest bucket segment; same-named files in different buckets differ', () => {
    // contract: specs/x.md and docs/x.md are distinct documents of types specs and docs
    expect(docTypeOf('specs/x.md')).toBe('specs');
    expect(docTypeOf('docs/x.md')).toBe('docs');
    expect(docTypeOf('insights/x.md')).toBe('insights');
    // contract: the deepest of several bucket segments wins
    expect(docTypeOf('e2e/docs/specs/x.md')).toBe('specs');
    expect(docTypeOf('specs/docs/y.md')).toBe('docs');
    expect(docTypeOf('.devdigest/specs/a.md')).toBe('specs');
    expect(docTypeOf('a/insights/b/docs/c/d.md')).toBe('docs');
  });
});

describe('toListPage', () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `docs/f${String(i).padStart(3, '0')}.md` }));

  it('AC-5: more than the limit returns the first 500 by path and truncated=true', () => {
    // contract: 501 matches -> 500 items (lowest paths) + truncated
    const input = mk(501).reverse(); // unsorted on purpose
    const page = toListPage(input, 500);
    expect(page.items).toHaveLength(500);
    expect(page.truncated).toBe(true);
    expect(page.items[0]!.path).toBe('docs/f000.md');
    expect(page.items[499]!.path).toBe('docs/f499.md');
  });

  it('AC-5: exactly the limit is not truncated; order is stable by path', () => {
    // contract: 500 matches -> all returned, truncated=false, sorted
    const page = toListPage(mk(500).reverse(), 500);
    expect(page.truncated).toBe(false);
    expect(page.items.map((i) => i.path)).toEqual(mk(500).map((i) => i.path));
  });
});

describe('buildEffectiveSet', () => {
  const skills = [
    { skill_id: 's1', name: 'one', paths: ['docs/x.md', 'specs/shared.md'] },
    { skill_id: 's2', name: 'two', paths: ['specs/shared.md', 'insights/z.md'] },
  ];

  it('AC-40: agent docs first in order, then each skill in order; duplicates keep the first occurrence', () => {
    const set = buildEffectiveSet(['specs/shared.md', 'specs/a.md'], skills);
    // contract: first occurrence of a full path wins, order is agent then skills in given order
    expect(set.map((i) => i.path)).toEqual(['specs/shared.md', 'specs/a.md', 'docs/x.md', 'insights/z.md']);
    expect(set[0]!.origin).toEqual({ kind: 'agent' });
    expect(set[2]!.origin).toEqual({ kind: 'skill', skill_id: 's1', name: 'one' });
    expect(set[3]!.origin).toEqual({ kind: 'skill', skill_id: 's2', name: 'two' });
  });

  it('AC-40: a path shared by two skills is attributed to the earlier skill', () => {
    const set = buildEffectiveSet([], skills);
    expect(set.find((i) => i.path === 'specs/shared.md')!.origin).toEqual({
      kind: 'skill',
      skill_id: 's1',
      name: 'one',
    });
  });

  it('AC-40: same file name in different directories stays two distinct documents', () => {
    // contract: dedupe is by FULL path only
    const set = buildEffectiveSet(['specs/x.md', 'docs/x.md'], []);
    expect(set.map((i) => i.path)).toEqual(['specs/x.md', 'docs/x.md']);
  });
});

describe('applyBudget', () => {
  const status = (items: Parameters<typeof applyBudget>[0], budget = 12000) =>
    applyBudget(items, budget).map((r) => r.status);

  it('AC-45: 7k/7k/2k against 12k -> attached, over_budget, attached (greedy)', () => {
    // contract: a document that does not fit is skipped whole, later ones that fit are still added
    expect(
      status([
        { path: 'a', tokens: 7000 },
        { path: 'b', tokens: 7000 },
        { path: 'c', tokens: 2000 },
      ]),
    ).toEqual(['attached', 'over_budget', 'attached']);
  });

  it('AC-45: a sum exactly equal to the budget fits', () => {
    // contract: exceeding means sum > budget
    expect(status([{ path: 'a', tokens: 6000 }, { path: 'b', tokens: 6000 }])).toEqual(['attached', 'attached']);
  });

  it('AC-45: null-token and >1 MB items are over_budget without consuming budget', () => {
    expect(
      status([
        { path: 'a', tokens: null },
        { path: 'b', tokens: 5000, over1mb: true },
        { path: 'c', tokens: 12000 },
      ]),
    ).toEqual(['over_budget', 'over_budget', 'attached']);
  });

  it('AC-45: an empty document (0 tokens) is attached even when the budget is full', () => {
    expect(status([{ path: 'a', tokens: 12000 }, { path: 'b', tokens: 0 }])).toEqual(['attached', 'attached']);
  });
});

describe('countUsage', () => {
  it('AC-12: an agent counts a doc attached directly or via an active skill (once); a skill counts direct attachments', () => {
    const usage = countUsage(
      [
        { agent_id: 'A1', paths: ['specs/a.md'] },
        { agent_id: 'A2', paths: [] },
        { agent_id: 'A3', paths: ['specs/a.md'] },
      ],
      [{ skill_id: 'S1', paths: ['specs/a.md', 'docs/b.md'] }],
      // A1 also has S1 active: specs/a.md must still count once for A1
      new Map([['A1', ['S1']], ['A2', ['S1']]]),
    );
    // contract: agents whose effective set contains the doc; skills that attached it directly
    expect(usage['specs/a.md']).toEqual({ agents: 3, skills: 1 });
    expect(usage['docs/b.md']).toEqual({ agents: 2, skills: 1 });
  });

  it('AC-12: a skill that is not active for the agent does not add to the agent count', () => {
    const usage = countUsage(
      [{ agent_id: 'A1', paths: [] }],
      [{ skill_id: 'S1', paths: ['docs/b.md'] }],
      new Map(), // S1 disabled for A1
    );
    expect(usage['docs/b.md']).toEqual({ agents: 0, skills: 1 });
  });
});

describe('toAttachmentDocs', () => {
  it('AC-31: a path absent from the full set is flagged missing; present ones keep order and metadata', () => {
    const full = new Map([['specs/a.md', { type: 'specs' as const, size_bytes: 10 }]]);
    const docs = toAttachmentDocs(['specs/a.md', 'docs/gone.md'], full, new Map([['specs/a.md', 7]]));
    // contract: attached path no longer in the repository -> missing
    expect(docs).toEqual([
      { path: 'specs/a.md', type: 'specs', tokens: 7, too_large: false, missing: false },
      { path: 'docs/gone.md', type: null, tokens: null, too_large: false, missing: true },
    ]);
  });
});

describe('docTypeOf — SPEC-02', () => {
  it('SPEC-02 AC-5: an INSIGHTS.md file name types insights at any depth', () => {
    // contract: the file name (any case) wins over the directories above it
    for (const p of ['server/INSIGHTS.md', 'INSIGHTS.md', 'a/b/insights.md', 'docs/INSIGHTS.md', 'specs/INSIGHTS.md']) {
      expect(docTypeOf(p)).toBe('insights');
    }
  });

  it('SPEC-02 AC-6: otherwise the deepest bucket segment, case-insensitive, default docs', () => {
    // contract: non-INSIGHTS file names are typed by the deepest specs/docs/insights directory segment
    expect(docTypeOf('e2e/docs/specs/x.md')).toBe('specs');
    expect(docTypeOf('insights/c.md')).toBe('insights');
    expect(docTypeOf('docs/insights/n.md')).toBe('insights');
    expect(docTypeOf('a/insights/b/docs/c/d.md')).toBe('docs');
    expect(docTypeOf('Docs/y.md')).toBe('docs');
    expect(docTypeOf('a/Specs/b.md')).toBe('specs');
    expect(docTypeOf('INSIGHTS/c.md')).toBe('insights');
    // contract: no bucket segment -> docs
    expect(docTypeOf('notes/random.md')).toBe('docs');
    // contract: same file name under different buckets are two documents with two types
    expect([docTypeOf('specs/x.md'), docTypeOf('docs/x.md')]).toEqual(['specs', 'docs']);
  });

  it('SPEC-02 AC-10: a path from a catch-all glob is typed by the same rule', () => {
    // contract: typing is a pure function of the path, whatever pattern matched it
    expect(docTypeOf('server/INSIGHTS.md')).toBe('insights');
    expect(docTypeOf('README.md')).toBe('docs');
  });
});
