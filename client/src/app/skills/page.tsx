import type { Metadata } from "next";
import { SkillsEmptyDetail } from "./_components/SkillsEmptyDetail";

export const metadata: Metadata = { title: "Skills" };

/* Route: /skills — nothing selected yet; the list lives in the layout. */
export default function SkillsPage() {
  return <SkillsEmptyDetail />;
}
