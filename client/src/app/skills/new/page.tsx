import { Suspense } from "react";
import type { Metadata } from "next";
import { SkillEditorView } from "@/components/skill-editor";

export const metadata: Metadata = { title: "New skill" };

/* Route: /skills/new — the editor in create mode. */
export default function NewSkillPage() {
  return (
    <Suspense fallback={null}>
      <SkillEditorView />
    </Suspense>
  );
}
