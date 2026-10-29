import type { Metadata } from "next";
import { ProjectContextView } from "./_components/ProjectContextView";

/* Route: /repos/:repoId/context (Workspace → Project Context). Thin server entry —
   resolves the route param; the list, filter, preview and refresh live under
   _components/ProjectContextView. */

export const metadata: Metadata = { title: "Project Context" };

type Params = Promise<{ repoId: string }>;

export default async function ProjectContextPage({ params }: { params: Params }) {
  const { repoId } = await params;
  return <ProjectContextView repoId={repoId} />;
}
