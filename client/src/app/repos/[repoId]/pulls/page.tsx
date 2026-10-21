import { Suspense } from "react";
import type { Metadata } from "next";
import { PullsListView } from "./_components/PullsListView";

/* Route: /repos/:repoId/pulls (PR list). Thin server entry — resolves the
   route param; the list, its filters (?status, ?sort) and rows live under
   _components/PullsListView. */

export const metadata: Metadata = { title: "Pull requests" };

type Params = Promise<{ repoId: string }>;

export default async function PullsPage({ params }: { params: Params }) {
  const { repoId } = await params;
  // Suspense at the leaf: the view reads useSearchParams (?status, ?sort).
  return (
    <Suspense fallback={null}>
      <PullsListView repoId={repoId} />
    </Suspense>
  );
}
