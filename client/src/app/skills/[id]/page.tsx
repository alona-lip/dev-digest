import { Suspense } from "react";
import type { Metadata } from "next";
import { SkillEditorView } from "@/components/skill-editor";

export const metadata: Metadata = { title: "Skill" };

type Params = Promise<{ id: string }>;

/* Route: /skills/:id — the skill editor (?tab=config|preview|evals|stats|versions). */
export default async function SkillEditorPage({ params }: { params: Params }) {
  const { id } = await params;
  // Suspense at the leaf: the view reads useSearchParams (?tab).
  return (
    <Suspense fallback={null}>
      <SkillEditorView id={id} />
    </Suspense>
  );
}
