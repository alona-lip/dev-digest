import type { Metadata } from "next";
import { ConventionsView } from "./_components/ConventionsView";

/* Route: /repos/:repoId/conventions (Skills Lab → Conventions). Thin server entry —
   resolves the route param; the scan, the candidate cards and the Create-skill modal
   live under _components/ConventionsView. */

export const metadata: Metadata = { title: "Conventions" };

type Params = Promise<{ repoId: string }>;

export default async function ConventionsPage({ params }: { params: Params }) {
  const { repoId } = await params;
  return <ConventionsView repoId={repoId} />;
}
