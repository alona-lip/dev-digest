/* hooks/blast.ts — React Query hooks for the PR Blast radius (what else in the repo the
   change reaches). The GET only reads the prebuilt repo-intel index (no LLM).
   `useBlastResync` re-indexes the repo and refetches the map once the index moved. */
"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useRepoIntelStatus, useResyncRepoIntel } from "./repo-intel";
import type { PrBlastRadius } from "@devdigest/shared";
import { BASELINE_MAX_AGE_MS, RESYNC_POLL_TIMEOUT_MS } from "./blast.constants";

const keys = {
  blast: (prId: string | null | undefined) => ["blast", prId] as const,
};

export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: keys.blast(prId),
    queryFn: () => api.get<PrBlastRadius>(`/pulls/${prId}/blast`),
    enabled: !!prId,
    retry: false,
  });
}

interface IndexSnapshot {
  lastIndexedSha: string | null;
  updatedAt: string | null;
}

/** `baseline === null` means "pending": no fresh index state was known at click time, so the
    first successful poll becomes the baseline and only a LATER change finishes the resync. */
interface ResyncRun {
  startedAt: number;
  baseline: IndexSnapshot | null;
}

const toSnapshot = (s: IndexSnapshot): IndexSnapshot => ({ lastIndexedSha: s.lastIndexedSha, updatedAt: s.updatedAt });

/** Resync the repo index, poll until it advanced (new SHA or touched `updatedAt`, which a
    same-SHA resync also does) or the timeout passes, then refetch the blast map. */
export function useBlastResync(repoId: string | null | undefined, prId: string | null | undefined, enabled = true) {
  const qc = useQueryClient();
  const resyncMutation = useResyncRepoIntel(repoId);
  const [run, setRun] = useState<ResyncRun | null>(null);
  const status = useRepoIntelStatus(enabled ? repoId : null, run !== null);
  const state = status.data;
  const { dataUpdatedAt, isError } = status;

  const finish = useCallback(() => {
    setRun(null);
    qc.invalidateQueries({ queryKey: keys.blast(prId) });
  }, [qc, prId]);

  // Completion: a fresh polled index state differs from the baseline. Stale data (older than
  // the click) and errored polls are ignored; a pending baseline is filled by the first fresh poll.
  useEffect(() => {
    if (!run || !state || isError || dataUpdatedAt < run.startedAt) return;
    if (run.baseline === null) {
      setRun({ ...run, baseline: toSnapshot(state) });
      return;
    }
    if (state.lastIndexedSha !== run.baseline.lastIndexedSha || state.updatedAt !== run.baseline.updatedAt) finish();
  }, [run, state, isError, dataUpdatedAt, finish]);

  // Safety net: stop polling and refetch anyway after the timeout.
  const active = run !== null;
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(finish, RESYNC_POLL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [active, finish]);

  const resync = () => {
    const now = Date.now();
    const usable = !!state && !isError && now - dataUpdatedAt <= BASELINE_MAX_AGE_MS;
    setRun({ startedAt: now, baseline: usable ? toSnapshot(state) : null });
    resyncMutation.mutate(undefined, { onError: finish });
  };

  return { resync, resyncing: run !== null, resyncError: resyncMutation.error };
}
