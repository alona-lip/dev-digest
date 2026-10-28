/* hooks/project-context.ts — project context (SPEC-01): the repo's .md documents,
   their usage counts, and the per-agent / per-skill ordered attachment lists. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ContextDocList,
  ContextDocContent,
  ContextUsage,
  ContextAttachments,
  ContextAttachmentsInput,
} from "@devdigest/shared";
import { api } from "../api";

export type ContextOwnerKind = "agent" | "skill";

/** Query keys for this domain — private: components use the hooks below. */
const keys = {
  docs: (repoId: string | null | undefined) => ["context-docs", repoId] as const,
  doc: (repoId: string | null | undefined, path: string | null | undefined) =>
    ["context-doc", repoId, path] as const,
  usage: (repoId: string | null | undefined) => ["context-usage", repoId] as const,
  attachments: (
    kind: ContextOwnerKind,
    ownerId: string | null | undefined,
    repoId: string | null | undefined,
  ) => ["context-attachments", kind, ownerId, repoId] as const,
};

const attachmentsUrl = (kind: ContextOwnerKind, ownerId: string) =>
  `/${kind}s/${ownerId}/context`;

/** GET /repos/:repoId/context — the repo's .md documents (first 500). */
export function useContextDocs(repoId: string | null | undefined) {
  return useQuery({
    queryKey: keys.docs(repoId),
    queryFn: () => api.get<ContextDocList>(`/repos/${repoId}/context`),
    enabled: !!repoId,
  });
}

/** GET /repos/:repoId/context/file?path= — one document's content; idle until a path is set. */
export function useContextDoc(
  repoId: string | null | undefined,
  path: string | null | undefined,
) {
  return useQuery({
    queryKey: keys.doc(repoId, path),
    queryFn: () =>
      api.get<ContextDocContent>(
        `/repos/${repoId}/context/file?path=${encodeURIComponent(path ?? "")}`,
      ),
    enabled: !!repoId && !!path,
  });
}

/** GET /repos/:repoId/context/usage — how many agents/skills use each path. */
export function useContextUsage(repoId: string | null | undefined) {
  return useQuery({
    queryKey: keys.usage(repoId),
    queryFn: () => api.get<ContextUsage>(`/repos/${repoId}/context/usage`),
    enabled: !!repoId,
  });
}

/** GET /{agents|skills}/:ownerId/context?repo_id= — the ordered attachment list. */
export function useAttachments(
  kind: ContextOwnerKind,
  ownerId: string | null | undefined,
  repoId: string | null | undefined,
) {
  return useQuery({
    queryKey: keys.attachments(kind, ownerId, repoId),
    queryFn: () =>
      api.get<ContextAttachments>(
        `${attachmentsUrl(kind, ownerId ?? "")}?repo_id=${encodeURIComponent(repoId ?? "")}`,
      ),
    enabled: !!ownerId && !!repoId,
  });
}

/**
 * PUT the whole ordered path list. Optimistic: the cached list is replaced at
 * once, rolled back to the snapshot on error, and refetched (attachments +
 * usage) when settled. The mutation variable is the new ordered `paths`.
 */
export function useSaveAttachments(
  kind: ContextOwnerKind,
  ownerId: string | null | undefined,
  repoId: string | null | undefined,
) {
  const qc = useQueryClient();
  const key = keys.attachments(kind, ownerId, repoId);
  const mutationKey = ["save-context-attachments", kind, ownerId, repoId] as const;
  return useMutation({
    mutationKey,
    // Saves for one owner/repo run one after another, so the last PUT (the
    // newest full list) always lands last. Optimistic updates still apply at once.
    scope: { id: mutationKey.join(":") },
    mutationFn: (paths: string[]) => {
      const body: ContextAttachmentsInput = { repo_id: repoId ?? "", paths };
      return api.put<ContextAttachments>(attachmentsUrl(kind, ownerId ?? ""), body);
    },
    onMutate: async (paths) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ContextAttachments>(key);
      if (previous) {
        const byPath = new Map(previous.docs.map((d) => [d.path, d]));
        // A newly attached path takes its type/tokens from the repo's document list.
        const listed = new Map(
          (qc.getQueryData<ContextDocList>(keys.docs(repoId))?.docs ?? []).map((d) => [d.path, d]),
        );
        qc.setQueryData<ContextAttachments>(key, {
          ...previous,
          paths,
          docs: paths.map((p) => {
            const known = byPath.get(p);
            if (known) return known;
            const doc = listed.get(p);
            return doc
              ? { path: p, type: doc.type, tokens: doc.tokens, too_large: doc.too_large, missing: false }
              : { path: p, type: null, tokens: null, too_large: false, missing: false };
          }),
        });
      }
      return { previous };
    },
    onError: (_e, _paths, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      // Refetch only after the last queued save: an earlier refetch would
      // overwrite the newer optimistic list. (This mutation still counts as 1.)
      if (qc.isMutating({ mutationKey }) > 1) return;
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: keys.usage(repoId) });
    },
  });
}
