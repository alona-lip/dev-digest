import { Suspense } from "react";
import type { Metadata } from "next";
import { AgentEditorView } from "./_components/AgentEditorView";

/* Route: /agents/:id (Agent editor). Thin server entry — resolves the route
   param; the agent list + editor live under _components/AgentEditorView. */

export const metadata: Metadata = { title: "Agent" };

type Params = Promise<{ id: string }>;

export default async function AgentEditorPage({ params }: { params: Params }) {
  const { id } = await params;
  // Suspense at the leaf: the view reads useSearchParams (?tab).
  return (
    <Suspense fallback={null}>
      <AgentEditorView id={id} />
    </Suspense>
  );
}
