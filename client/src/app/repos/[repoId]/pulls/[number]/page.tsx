import { Suspense } from "react";
import type { Metadata } from "next";
import { PrDetailView } from "./_components/PrDetailView";

/* Route: /repos/:repoId/pulls/:number (PR detail). Thin server entry —
   resolves the route params and names the tab; the interactive view (tabs,
   findings, live runs, diff) is colocated under _components/PrDetailView. */

type Params = Promise<{ repoId: string; number: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { number } = await params;
  return { title: `PR #${number}` };
}

export default async function PrDetailPage({ params }: { params: Params }) {
  const { repoId, number } = await params;
  // Suspense at the leaf: the view reads useSearchParams (?tab, ?severity).
  return (
    <Suspense fallback={null}>
      <PrDetailView repoId={repoId} number={number} />
    </Suspense>
  );
}
