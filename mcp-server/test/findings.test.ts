import { describe, expect, it } from 'vitest';
import { loadReview, shapeFindings } from '../src/core/findings.js';
import { fakeClient, finding, review, runSummary } from './fixtures.js';

const mixed = review({
  findings: [
    finding('SUGGESTION', 's1'),
    finding('CRITICAL', 'c1', 10),
    finding('WARNING', 'w1'),
    finding('CRITICAL', 'c2', 20),
  ],
});

describe('shapeFindings', () => {
  it('sorts worst first and keeps stored order within a severity', () => {
    const page = shapeFindings(mixed, { format: 'concise', offset: 0, limit: 10 });
    expect(page.findings.map((f) => f.title)).toEqual(['c1', 'c2', 'w1', 's1']);
  });

  it('counts every finding even when the page is smaller', () => {
    const page = shapeFindings(mixed, { format: 'concise', offset: 1, limit: 2 });
    expect(page).toMatchObject({
      counts: { CRITICAL: 2, WARNING: 1, SUGGESTION: 1 },
      total: 4,
      returned: 2,
      offset: 1,
    });
    expect(page.findings.map((f) => f.title)).toEqual(['c2', 'w1']);
  });

  it('concise keeps file:line and drops ids, suggestion and confidence', () => {
    const [first] = shapeFindings(mixed, { format: 'concise', offset: 0, limit: 1 }).findings;
    expect(first).toEqual({ severity: 'CRITICAL', title: 'c1', file: 'src/app.ts', line: 10, rationale: 'why c1' });
  });

  it('detailed adds id, category, end_line, confidence and suggestion', () => {
    const [first] = shapeFindings(mixed, { format: 'detailed', offset: 0, limit: 1 }).findings;
    expect(first).toMatchObject({ id: 'f-c1', category: 'security', end_line: 12, confidence: 0.9, suggestion: null });
  });

  it('carries the verdict, score, summary and the run it came from', () => {
    expect(shapeFindings(mixed, { format: 'concise', offset: 0, limit: 1 })).toMatchObject({
      run_id: 'run-1',
      agent: 'Security Reviewer',
      verdict: 'request_changes',
      score: 40,
      summary: 'one critical issue',
    });
  });
});

describe('loadReview', () => {
  const older = review({ id: 'old', run_id: 'run-0', created_at: '2026-10-23T10:00:00.000Z' });
  const newer = review({ id: 'new', run_id: 'run-1', created_at: '2026-10-24T10:00:00.000Z' });
  const summaryRow = review({ id: 'sum', run_id: null, kind: 'summary', created_at: '2026-10-25T10:00:00.000Z' });

  it('returns the newest review row, ignoring summary rows', async () => {
    const client = fakeClient({ listReviews: async () => [older, summaryRow, newer] });
    expect(await loadReview(client, 'pull-3')).toMatchObject({ kind: 'review', review: { id: 'new' } });
  });

  it('says to run a review when the PR has none', async () => {
    const client = fakeClient({ listReviews: async () => [summaryRow] });
    expect(await loadReview(client, 'pull-3')).toEqual({
      kind: 'missing',
      error: expect.stringContaining('Call run_agent_on_pr first'),
    });
  });

  it('returns the exact run when run_id is given', async () => {
    const client = fakeClient({ listReviews: async () => [older, newer] });
    expect(await loadReview(client, 'pull-3', 'run-0')).toMatchObject({ review: { id: 'old' } });
  });

  it('reports a run without a review yet as running', async () => {
    const client = fakeClient({
      listReviews: async () => [older],
      listRuns: async () => [runSummary('run-9', 'running')],
    });
    expect(await loadReview(client, 'pull-3', 'run-9')).toEqual({ kind: 'running', run_id: 'run-9' });
  });

  it('reports a failed run with its error instead of another run’s findings', async () => {
    const client = fakeClient({
      listReviews: async () => [newer],
      listRuns: async () => [runSummary('run-9', 'failed', 'LLM timeout')],
    });
    expect(await loadReview(client, 'pull-3', 'run-9')).toEqual({
      kind: 'missing',
      error: 'Run run-9 failed: LLM timeout. Start a new one with run_agent_on_pr.',
    });
  });

  it('lists the PR’s runs when run_id belongs elsewhere', async () => {
    const client = fakeClient({ listReviews: async () => [older, newer], listRuns: async () => [] });
    const res = await loadReview(client, 'pull-3', 'run-x');
    expect(res).toEqual({ kind: 'missing', error: expect.stringContaining('Runs with reviews on this PR: run-0, run-1') });
  });
});
