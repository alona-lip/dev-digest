import { describe, expect, it, vi } from 'vitest';
import type { RunSummary } from '@devdigest/shared';
import { runReviewAndWait, type RunWaitOpts } from '../src/core/run-review.js';
import { ApiError } from '../src/http/client.js';
import { fakeClient, review, runSummary } from './fixtures.js';

const target = { pullId: 'pull-3', agentId: 'a-sec' };
const triggered = { pr_id: 'pull-3', runs: [{ run_id: 'run-1', agent_id: 'a-sec', agent_name: 'Security Reviewer' }], reviews: [] };

/** A clock that advances only when the code under test sleeps. */
function fakeClock(timeoutMs = 10_000): RunWaitOpts {
  let t = 0;
  return {
    pollIntervalMs: 1_000,
    runTimeoutMs: timeoutMs,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
}

/** Each listRuns call returns the next snapshot; the last one repeats. */
function runsSequence(...snapshots: (RunSummary[] | Error)[]) {
  let i = 0;
  return vi.fn(async () => {
    const snap = snapshots[Math.min(i++, snapshots.length - 1)];
    if (snap instanceof Error) throw snap;
    return snap ?? [];
  });
}

describe('runReviewAndWait', () => {
  it('waits for done and returns that run’s review', async () => {
    const triggerReview = vi.fn(async () => triggered);
    const client = fakeClient({
      triggerReview,
      listRuns: runsSequence([], [runSummary('run-1', 'running')], [runSummary('run-1', 'done')]),
      listReviews: async () => [review({ id: 'other', run_id: 'run-0' }), review({ id: 'mine', run_id: 'run-1' })],
    });

    const out = await runReviewAndWait(client, target, fakeClock());

    expect(out).toMatchObject({ kind: 'done', run_id: 'run-1', review: { id: 'mine' } });
    expect(triggerReview).toHaveBeenCalledTimes(1);
    expect(triggerReview).toHaveBeenCalledWith('pull-3', 'a-sec');
  });

  it('returns the run error when the run fails', async () => {
    const client = fakeClient({
      triggerReview: async () => triggered,
      listRuns: runsSequence([runSummary('run-1', 'failed', 'provider key missing')]),
    });
    expect(await runReviewAndWait(client, target, fakeClock())).toEqual({
      kind: 'failed',
      run_id: 'run-1',
      error: 'provider key missing',
    });
  });

  it('answers running at the deadline and never re-triggers', async () => {
    const triggerReview = vi.fn(async () => triggered);
    const listRuns = runsSequence([runSummary('run-1', 'running')]);
    const client = fakeClient({ triggerReview, listRuns });

    expect(await runReviewAndWait(client, target, fakeClock(5_000))).toEqual({ kind: 'running', run_id: 'run-1' });
    expect(triggerReview).toHaveBeenCalledTimes(1);
    expect(listRuns).toHaveBeenCalledTimes(5);
  });

  it('keeps polling through a failed GET', async () => {
    const client = fakeClient({
      triggerReview: async () => triggered,
      listRuns: runsSequence(new ApiError(0, 'x', 'down'), [runSummary('run-1', 'done')]),
      listReviews: async () => [review({ run_id: 'run-1' })],
    });
    expect(await runReviewAndWait(client, target, fakeClock())).toMatchObject({ kind: 'done' });
  });

  it('retries the review fetch after done instead of surfacing "API down"', async () => {
    const listReviews = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, 'x', 'blip'))
      .mockResolvedValue([review({ id: 'mine', run_id: 'run-1' })]);
    const client = fakeClient({
      triggerReview: async () => triggered,
      listRuns: runsSequence([runSummary('run-1', 'done')]),
      listReviews,
    });
    expect(await runReviewAndWait(client, target, fakeClock())).toMatchObject({ kind: 'done', review: { id: 'mine' } });
    expect(listReviews).toHaveBeenCalledTimes(2);
  });

  it('keeps the run_id when the review fetch fails until the deadline', async () => {
    const triggerReview = vi.fn(async () => triggered);
    const client = fakeClient({
      triggerReview,
      listRuns: runsSequence([runSummary('run-1', 'done')]),
      listReviews: async () => {
        throw new ApiError(0, 'x', 'down');
      },
    });
    expect(await runReviewAndWait(client, target, fakeClock(3_000))).toEqual({ kind: 'running', run_id: 'run-1' });
    expect(triggerReview).toHaveBeenCalledTimes(1);
  });

  it('reports no run id when the API created no run', async () => {
    const client = fakeClient({ triggerReview: async () => ({ ...triggered, runs: [] }) });
    expect(await runReviewAndWait(client, target, fakeClock())).toMatchObject({ kind: 'failed', run_id: null });
  });

  it('lets a trigger failure (e.g. 429) reach the tool as ApiError', async () => {
    const client = fakeClient({
      triggerReview: async () => {
        throw new ApiError(429, 'x', 'Rate limit exceeded');
      },
    });
    await expect(runReviewAndWait(client, target, fakeClock())).rejects.toMatchObject({ status: 429 });
  });
});
