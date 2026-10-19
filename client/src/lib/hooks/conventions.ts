/* hooks/conventions.ts — React Query hooks for the Conventions Extractor: a repo's
   convention candidates, the scan, triage (accept / reject / edit) and the skill
   draft built from the accepted ones. Saving the skill lives in hooks/skills.ts
   (useCreateConventionSkill) next to the other skill writes. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  BulkConventionStatusInput,
  ConventionCandidate,
  ConventionSkillDraft,
  ExtractConventionsResult,
  UpdateConventionInput,
} from "@devdigest/shared";

const keys = {
  list: (repoId: string | null | undefined) => ["conventions", repoId] as const,
  draft: (repoId: string | null | undefined) => ["conventions-skill-draft", repoId] as const,
};

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: keys.list(repoId),
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/** Run Scan / Re-scan — a mutation, since every call costs one model call. */
export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ExtractConventionsResult>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (res) => qc.setQueryData(keys.list(repoId), res.candidates),
  });
}

/** Accept / reject / inline edit — applied to the list at once, rolled back on error. */
export function useUpdateConvention(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateConventionInput }) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: keys.list(repoId) });
      const previous = qc.getQueryData<ConventionCandidate[]>(keys.list(repoId));
      qc.setQueryData<ConventionCandidate[]>(keys.list(repoId), (list) =>
        list?.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.list(repoId), ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.list(repoId) }),
  });
}

/** One status for many candidates ("Deselect all" → REJECTED). */
export function useBulkConventionStatus(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkConventionStatusInput) =>
      api.patch<ConventionCandidate[]>(`/repos/${repoId}/conventions`, input),
    onSuccess: (list) => qc.setQueryData(keys.list(repoId), list),
  });
}

/** The skill built from the ACCEPTED candidates. Always refetched when the modal opens,
    so it reflects the latest triage and the current version of the existing skill. */
export function useConventionSkillDraft(repoId: string | null | undefined) {
  return useQuery({
    queryKey: keys.draft(repoId),
    queryFn: () => api.get<ConventionSkillDraft>(`/repos/${repoId}/conventions/skill-draft`),
    enabled: !!repoId,
    staleTime: 0,
    gcTime: 0,
  });
}
