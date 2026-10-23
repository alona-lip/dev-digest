/* hooks/intent.ts — React Query hooks for the Intent Layer: a PR's derived purpose
   and scope. The GET computes + stores the intent server-side on first open, so the
   first load can take a model call; Recompute always re-derives it. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PrIntentRecord } from "@devdigest/shared";

const keys = {
  intent: (prId: string | null | undefined) => ["intent", prId] as const,
};

export function useIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: keys.intent(prId),
    queryFn: () => api.get<PrIntentRecord>(`/pulls/${prId}/intent`),
    enabled: !!prId,
    // A failed derivation (e.g. no key for the intent model) is shown, not retried in a loop.
    retry: false,
  });
}

/** Recompute — a mutation, since every call costs one model call. */
export function useRecomputeIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrIntentRecord>(`/pulls/${prId}/intent/recompute`),
    onSuccess: (data) => qc.setQueryData(keys.intent(prId), data),
  });
}
