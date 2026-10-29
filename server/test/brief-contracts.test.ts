import { describe, it, expect } from 'vitest';
import { toJsonSchema } from '@devdigest/reviewer-core';
import {
  BriefModelOutput,
  BriefRecord,
  BriefResponse,
  ReviewFocusItem,
  Risk,
  RiskKind,
} from '@devdigest/shared';

const RISK = {
  kind: 'security',
  title: 'Rate limit bypass',
  explanation: 'Header is trusted',
  severity: 'high',
  file_refs: ['src/a.ts:12-18'],
};

const OUTPUT = {
  summary: 'Adds rate limiting to the public API.',
  risks: [RISK],
  review_focus: [{ file: 'src/a.ts', line: 12, reason: 'New limiter entry point' }],
};

describe('PR brief contracts (SPEC-03)', () => {
  it('AC-1: a valid model-output fixture parses with snake_case wire fields', () => {
    // contract: the model-output shape is { summary, risks, review_focus }
    const parsed = BriefModelOutput.safeParse(OUTPUT);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data).sort()).toEqual(['review_focus', 'risks', 'summary']);
    }
  });

  it('AC-1: an empty summary is rejected', () => {
    // contract: summary must be non-empty
    expect(BriefModelOutput.safeParse({ ...OUTPUT, summary: '' }).success).toBe(false);
    // contract: a whitespace-only summary is empty as well
    expect(BriefModelOutput.safeParse({ ...OUTPUT, summary: '   ' }).success).toBe(false);
  });

  it('AC-1: a focus item with line 0 (or a non-integer / negative line) is rejected', () => {
    // contract: line is an integer >= 1
    const item = { file: 'src/a.ts', line: 1, reason: 'why' };
    expect(ReviewFocusItem.safeParse(item).success).toBe(true);
    expect(ReviewFocusItem.safeParse({ ...item, line: 0 }).success).toBe(false);
    expect(ReviewFocusItem.safeParse({ ...item, line: -3 }).success).toBe(false);
    expect(ReviewFocusItem.safeParse({ ...item, line: 1.5 }).success).toBe(false);
    expect(
      BriefModelOutput.safeParse({ ...OUTPUT, review_focus: [{ ...item, line: 0 }] }).success,
    ).toBe(false);
  });

  it('AC-1: a focus item with an empty reason is rejected', () => {
    // contract: reason must be non-empty
    const item = { file: 'src/a.ts', line: 1, reason: '' };
    expect(ReviewFocusItem.safeParse(item).success).toBe(false);
    expect(ReviewFocusItem.safeParse({ ...item, reason: '  ' }).success).toBe(false);
    expect(BriefModelOutput.safeParse({ ...OUTPUT, review_focus: [item] }).success).toBe(false);
  });

  it('AC-1: the model-output JSON schema sent to the provider has no keywords strict mode rejects', () => {
    // OpenAI strict json_schema rejects length/range/format keywords; a .min(1) here made every
    // real Generate call fail with a 400 that the mock provider never sees.
    const schema = JSON.stringify(toJsonSchema(BriefModelOutput, 'BriefModelOutput').schema);
    expect(schema).not.toMatch(/"(minLength|maxLength|minimum|maximum|pattern|format)"/);
  });

  it('AC-1: the stored brief and the read response shapes parse valid fixtures and reject bad ones', () => {
    // contract: stored brief carries the fields listed in the spec's "Contract shapes"
    const record = {
      pr_id: 'pr-1',
      head_sha: 'abc',
      generated_at: '2026-10-29T00:00:00.000Z',
      model: 'openai/gpt-4.1',
      summary: OUTPUT.summary,
      risks: [RISK],
      review_focus: OUTPUT.review_focus,
      missing_inputs: [{ input: 'intent', reason: 'not_computed' }],
      trimmed_inputs: ['specs'],
      dropped: { risks: 0, review_focus: 1 },
      input_tokens: 1234,
      cost_usd: null,
    };
    expect(BriefRecord.safeParse(record).success).toBe(true);
    // contract: missing_inputs[].input is one of intent | blast | linked_issue | specs
    expect(
      BriefRecord.safeParse({ ...record, missing_inputs: [{ input: 'diff', reason: 'x' }] }).success,
    ).toBe(false);
    // contract: trimmed_inputs only names specs | linked_issue | description
    expect(BriefRecord.safeParse({ ...record, trimmed_inputs: ['intent'] }).success).toBe(false);

    // contract: the read response is `none` or `ready` with stale + current_head_sha + brief
    expect(BriefResponse.safeParse({ status: 'none' }).success).toBe(true);
    expect(
      BriefResponse.safeParse({ status: 'ready', stale: false, current_head_sha: 'abc', brief: record }).success,
    ).toBe(true);
    expect(BriefResponse.safeParse({ status: 'ready', brief: record }).success).toBe(false);
  });

  it.each(['security', 'dependency', 'performance', 'breaking_change', 'data', 'config', 'other'])(
    'AC-62: Risk.kind "%s" parses',
    (kind) => {
      // contract: every member of the closed enum is a valid kind
      expect(RiskKind.safeParse(kind).success).toBe(true);
      expect(Risk.safeParse({ ...RISK, kind }).success).toBe(true);
    },
  );

  it('AC-62: kind "auth" (outside the enum) is rejected', () => {
    // contract: the enum is closed
    expect(RiskKind.safeParse('auth').success).toBe(false);
    expect(Risk.safeParse({ ...RISK, kind: 'auth' }).success).toBe(false);
    // contract: so a model output carrying such a risk is invalid output (feeds AC-63)
    expect(BriefModelOutput.safeParse({ ...OUTPUT, risks: [{ ...RISK, kind: 'auth' }] }).success).toBe(false);
  });
});
