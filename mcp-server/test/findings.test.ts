import { describe, expect, it } from 'vitest';
import { loadReviews, shapeFindings, shapeReviews } from '../src/core/findings.js';
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

describe('shapeReviews', () => {
  const second = review({ id: 'r2', run_id: 'run-2', findings: [finding('WARNING', 'w9')] });

  it('keeps the given order, nests findings per review and sums total_findings', () => {
    const out = shapeReviews([second, mixed], { format: 'concise', offset: 0, limit: 10 });
    expect(out.total_findings).toBe(5);
    expect(out.reviews.map((r) => r.run_id)).toEqual(['run-2', 'run-1']);
    expect(out.reviews[1]!.findings.map((f) => f.title)).toEqual(['c1', 'c2', 'w1', 's1']);
  });

  it('pages each review on its own; total_findings counts before paging', () => {
    const out = shapeReviews([second, mixed], { format: 'concise', offset: 1, limit: 1 });
    expect(out.total_findings).toBe(5);
    expect(out.reviews.map((r) => r.returned)).toEqual([0, 1]);
    expect(out.reviews[1]!.findings.map((f) => f.title)).toEqual(['c2']);
  });

  it('no reviews → empty list, zero total', () => {
    expect(shapeReviews([], { format: 'concise', offset: 0, limit: 10 })).toEqual({ total_findings: 0, reviews: [] });
  });
});

describe('loadReviews', () => {
  const older = review({ id: 'old', run_id: 'run-0', created_at: '2026-10-23T10:00:00.000Z' });
  const newer = review({ id: 'new', run_id: 'run-1', created_at: '2026-10-24T10:00:00.000Z' });
  const general = review({
    id: 'gen',
    run_id: 'run-g',
    agent_id: 'a-gen',
    agent_name: 'General Reviewer',
    created_at: '2026-10-25T09:00:00.000Z',
  });
  const summaryRow = review({ id: 'sum', run_id: null, kind: 'summary', created_at: '2026-10-25T10:00:00.000Z' });
  const sec = { id: 'a-sec', name: 'Security Reviewer' };
  const ids = (res: Awaited<ReturnType<typeof loadReviews>>) => (res.kind === 'reviews' ? res.reviews.map((r) => r.id) : res);

  it('returns only the newest review row, ignoring summary rows', async () => {
    const client = fakeClient({ listReviews: async () => [older, summaryRow, newer] });
    expect(ids(await loadReviews(client, 'pull-3'))).toEqual(['new']);
  });

  it('all_runs returns every review row, newest first, without summary rows', async () => {
    const client = fakeClient({ listReviews: async () => [older, summaryRow, general, newer] });
    expect(ids(await loadReviews(client, 'pull-3', { allRuns: true }))).toEqual(['gen', 'new', 'old']);
  });

  it('agent narrows to that agent: newest by default, all with all_runs', async () => {
    const client = fakeClient({ listReviews: async () => [older, general, newer] });
    expect(ids(await loadReviews(client, 'pull-3', { agent: sec }))).toEqual(['new']);
    expect(ids(await loadReviews(client, 'pull-3', { agent: sec, allRuns: true }))).toEqual(['new', 'old']);
  });

  it('says to run a review when the PR has none', async () => {
    const client = fakeClient({ listReviews: async () => [summaryRow] });
    expect(await loadReviews(client, 'pull-3')).toEqual({
      kind: 'missing',
      error: expect.stringContaining('Call run_agent_on_pr first'),
    });
  });

  it('names the agent when only other agents reviewed the PR', async () => {
    const client = fakeClient({ listReviews: async () => [general] });
    expect(await loadReviews(client, 'pull-3', { agent: sec })).toEqual({
      kind: 'missing',
      error: "Agent 'Security Reviewer' has no completed review on this PR. Call run_agent_on_pr with agent 'a-sec' first.",
    });
  });

  it('rejects run_id together with all_runs', async () => {
    const client = fakeClient();
    expect(await loadReviews(client, 'pull-3', { runId: 'run-0', allRuns: true })).toEqual({
      kind: 'missing',
      error: expect.stringContaining('not both'),
    });
  });

  it('returns the exact run when run_id is given', async () => {
    const client = fakeClient({ listReviews: async () => [older, newer] });
    expect(ids(await loadReviews(client, 'pull-3', { runId: 'run-0' }))).toEqual(['old']);
  });

  it('reports a run_id that belongs to another agent', async () => {
    const client = fakeClient({ listReviews: async () => [general] });
    expect(await loadReviews(client, 'pull-3', { runId: 'run-g', agent: sec })).toEqual({
      kind: 'missing',
      error: "Run run-g belongs to 'General Reviewer', not 'Security Reviewer'. Drop agent or run_id.",
    });
  });

  it('reports a run without a review yet as running', async () => {
    const client = fakeClient({
      listReviews: async () => [older],
      listRuns: async () => [runSummary('run-9', 'running')],
    });
    expect(await loadReviews(client, 'pull-3', { runId: 'run-9' })).toEqual({ kind: 'running', run_id: 'run-9' });
  });

  it('reports a failed run with its error instead of another run’s findings', async () => {
    const client = fakeClient({
      listReviews: async () => [newer],
      listRuns: async () => [runSummary('run-9', 'failed', 'LLM timeout')],
    });
    expect(await loadReviews(client, 'pull-3', { runId: 'run-9' })).toEqual({
      kind: 'missing',
      error: 'Run run-9 failed: LLM timeout. Start a new one with run_agent_on_pr.',
    });
  });

  it('lists the PR’s runs when run_id belongs elsewhere', async () => {
    const client = fakeClient({ listReviews: async () => [older, newer], listRuns: async () => [] });
    const res = await loadReviews(client, 'pull-3', { runId: 'run-x' });
    expect(res).toEqual({ kind: 'missing', error: expect.stringContaining('Runs with reviews on this PR: run-0, run-1') });
  });
});
