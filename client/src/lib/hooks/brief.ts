/* hooks/brief.ts — React Query hooks for the generated PR Brief (SPEC-03).
   GET  /pulls/:id/brief → BriefResponse ({status:"none"} | {status:"ready", stale, brief}).
   POST /pulls/:id/brief → generates (one model call) and returns the same shape.
   Generation is a mutation with a shared key so any component can ask whether one is in flight. */
"use client";

import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { BriefResponse } from "@devdigest/shared";

const keys = {
  brief: (prId: string | null | undefined) => ["brief", prId] as const,
  generate: (prId: string | null | undefined) => ["brief", "generate", prId] as const,
};

export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: keys.brief(prId),
    queryFn: () => api.get<BriefResponse>(`/pulls/${prId}/brief`),
    enabled: !!prId,
    retry: false,
  });
}

export function useGeneratePrBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: keys.generate(prId),
    mutationFn: () => api.post<BriefResponse>(`/pulls/${prId}/brief`),
    onSuccess: (data) => qc.setQueryData(keys.brief(prId), data),
  });
}

/** True while a generation for this PR is running, from any component. */
export function useIsGeneratingPrBrief(prId: string | null | undefined) {
  return useIsMutating({ mutationKey: keys.generate(prId) }) > 0;
}
