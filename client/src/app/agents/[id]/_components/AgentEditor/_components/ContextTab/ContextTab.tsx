/* ContextTab — agent editor's Context tab: attach the active repo's `.md`
   documents to this agent. Pure wiring around the shared picker. */
"use client";

import React from "react";
import { ContextDocsPicker } from "@/components/context-docs-picker";
import { useActiveRepo } from "@/lib/repo-context";

export function ContextTab({ agentId }: { agentId: string }) {
  const { repoId } = useActiveRepo();
  return <ContextDocsPicker kind="agent" ownerId={agentId} repoId={repoId} />;
}
