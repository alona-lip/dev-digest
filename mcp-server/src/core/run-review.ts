/**
 * Trigger ONE review run and wait for it — the "result, not operation" half
 * of run_agent_on_pr. The trigger is sent exactly once (the route is
 * rate-limited to 10/min); only the cheap GET of the run list is repeated.
 */
import type { ReviewRecord } from '@devdigest/shared';
import type { DevDigestClient } from '../http/client.js';

export type RunOutcome =
  | { kind: 'done'; run_id: string; review: ReviewRecord }
  | { kind: 'running'; run_id: string }
  /** `run_id` null = the API created no run at all. */
  | { kind: 'failed'; run_id: string | null; error: string };

export type RunWaitOpts = {
  pollIntervalMs: number;
  runTimeoutMs: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Trigger errors (404, 429, API down) are thrown as ApiError for the tool to
 * map. Once the run exists, every failing GET (run list AND the review fetch
 * after `done`) is retried until the deadline, which then answers `running`
 * with the run_id: a finished paid run must never surface as "API down, retry"
 * — that would make the model start a new run instead of calling get_findings.
 */
export async function runReviewAndWait(
  client: DevDigestClient,
  target: { pullId: string; agentId: string },
  opts: RunWaitOpts,
): Promise<RunOutcome> {
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;

  const triggered = await client.triggerReview(target.pullId, target.agentId);
  const run = triggered.runs[0];
  if (!run) return { kind: 'failed', run_id: null, error: 'the API accepted the request but created no run' };
  const runId = run.run_id;
  const deadline = now() + opts.runTimeoutMs;

  while (now() < deadline) {
    await sleep(opts.pollIntervalMs);

    let summary;
    try {
      summary = (await client.listRuns(target.pullId)).find((r) => r.run_id === runId);
    } catch {
      continue;
    }

    if (summary?.status === 'done') {
      // `done` and the review row commit in one transaction
      // (ReviewRepository.persistCompletedRun), so the review is there.
      let reviews;
      try {
        reviews = await client.listReviews(target.pullId);
      } catch {
        continue;
      }
      const review = reviews.find((r) => r.kind === 'review' && r.run_id === runId);
      if (review) return { kind: 'done', run_id: runId, review };
      return { kind: 'failed', run_id: runId, error: `run ${runId} is done but has no review row` };
    }
    if (summary?.status === 'failed' || summary?.status === 'cancelled') {
      return { kind: 'failed', run_id: runId, error: summary.error ?? `run ended with status '${summary.status}'` };
    }
    // null / 'running' / not listed yet → keep waiting
  }

  return { kind: 'running', run_id: runId };
}
