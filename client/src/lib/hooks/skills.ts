/* hooks/skills.ts — React Query hooks for the Skills Lab: the skill library,
   its versions/stats, import preview, and an agent's skill bindings. */
"use client";

import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentSkillLink,
  CreateSkillInput,
  Skill,
  SkillImportPreview,
  SkillImportRequest,
  SkillListItem,
  SkillStats,
  SkillVersion,
  UpdateSkillInput,
} from "@devdigest/shared";

const keys = {
  all: ["skills"] as const,
  one: (id: string | null | undefined) => ["skill", id] as const,
  versions: (id: string) => ["skill-versions", id] as const,
  stats: (id: string | null | undefined) => ["skill-stats", id] as const,
  agentSkillsAll: ["agent-skills"] as const,
  agentSkills: (agentId: string | null | undefined) => ["agent-skills", agentId] as const,
};

export function useSkills() {
  return useQuery({ queryKey: keys.all, queryFn: () => api.get<SkillListItem[]>("/skills") });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: keys.one(id),
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: keys.versions(id ?? ""),
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

export function useSkillStats(id: string | null | undefined) {
  return useQuery({
    queryKey: keys.stats(id),
    queryFn: () => api.get<SkillStats>(`/skills/${id}/stats`),
    enabled: !!id,
  });
}

/** After a skill changed: list cards, this skill, its history, and every agent's skill tab. */
function skillChanged(qc: QueryClient, skill: Skill) {
  qc.setQueryData(keys.one(skill.id), skill);
  qc.invalidateQueries({ queryKey: keys.all });
  qc.invalidateQueries({ queryKey: keys.versions(skill.id) });
  qc.invalidateQueries({ queryKey: keys.agentSkillsAll });
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: (skill) => skillChanged(qc, skill),
  });
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateSkillInput }) =>
      api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (skill) => skillChanged(qc, skill),
  });
}

export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.post<Skill>(`/skills/${id}/versions/${version}/restore`),
    onSuccess: (skill) => skillChanged(qc, skill),
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.invalidateQueries({ queryKey: keys.agentSkillsAll });
      qc.invalidateQueries({ queryKey: ["agents"] }); // agent tiles count skill links
      qc.removeQueries({ queryKey: keys.one(id) });
      qc.removeQueries({ queryKey: keys.versions(id) });
      qc.removeQueries({ queryKey: keys.stats(id) });
    },
  });
}

/** Parses an uploaded .md/.zip into an editable preview. Saves NOTHING. */
export function useImportSkillPreview() {
  return useMutation({
    mutationFn: (req: SkillImportRequest) =>
      api.post<SkillImportPreview>("/skills/import/preview", req),
  });
}

// ---- an agent's skill bindings -------------------------------------------

export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: keys.agentSkills(agentId),
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

export interface SkillBinding {
  skill_id: string;
  enabled: boolean;
}

/**
 * Replace the agent's whole skill list (array order = prompt order). Optimistic:
 * the tab reorders/toggles instantly and rolls back if the server refuses.
 */
export function useSetAgentSkills(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skills: SkillBinding[]) =>
      api.put<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skills }),
    onMutate: async (skills) => {
      await qc.cancelQueries({ queryKey: keys.agentSkills(agentId) });
      const previous = qc.getQueryData<AgentSkillLink[]>(keys.agentSkills(agentId));
      qc.setQueryData<AgentSkillLink[]>(
        keys.agentSkills(agentId),
        skills.map((b, order) => ({ agent_id: agentId, skill_id: b.skill_id, order, enabled: b.enabled })),
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.agentSkills(agentId), ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.agentSkills(agentId) });
      // the agent's config version may have moved, and cards show agent counts
      qc.invalidateQueries({ queryKey: ["agent", agentId] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: keys.all });
    },
  });
}
