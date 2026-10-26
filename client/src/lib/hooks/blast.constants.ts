/* Timing constants for the blast-radius hooks (resync flow, prior-PRs cache). Kept out of blast.ts so the
   `@/lib/hooks` barrel exports hooks only; blast.ts and its test import this directly. */

/** A resync that never writes an index row (enqueue failed, no clone) must not poll forever. */
export const RESYNC_POLL_TIMEOUT_MS = 120_000;

/** Cached index state older than this is not trusted as the "before resync" baseline. */
export const BASELINE_MAX_AGE_MS = 5_000;

/** Prior-PR history costs a GitHub call; reuse it for a few minutes. */
export const PRIOR_PRS_STALE_MS = 5 * 60_000;
