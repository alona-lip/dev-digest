/**
 * Blast radius of a PR for a tool reply: resolve (repo, PR number) → pullId,
 * fetch the prebuilt map, shape it concisely. `downstream` is passed through
 * unchanged — it is the same map the UI shows.
 */
import type { BlastDegradedReason, DownstreamImpact } from '@devdigest/shared';
import type { DevDigestClient } from '../http/client.js';
import { resolvePull, type Miss } from './resolve.js';

export type BlastReply = {
  repo: string;
  pr: number;
  summary: string;
  degraded: boolean;
  reason: BlastDegradedReason | null;
  /** `name@file` — one short string per changed symbol. */
  changed_symbols: string[];
  downstream: DownstreamImpact[];
};

/** An ApiError from the client propagates; the tool maps it (format.apiFailure). */
export async function getBlast(client: DevDigestClient, repo: string, pr: number): Promise<BlastReply | Miss> {
  const pull = await resolvePull(client, repo, pr);
  if ('error' in pull) return pull;

  const blast = await client.getBlastRadius(pull.pullId);
  return {
    repo: pull.fullName,
    pr,
    summary: blast.summary,
    degraded: blast.degraded,
    reason: blast.reason,
    changed_symbols: blast.changed_symbols.map((s) => `${s.name}@${s.file}`),
    downstream: blast.downstream,
  };
}
