import { SkillsLayout } from "./_components/SkillsLayout";

/* Layout for /skills/*: the skill list stays mounted while the right pane
   (select prompt / new skill / skill editor) changes with the route. */
export default function SkillsRouteLayout({ children }: { children: React.ReactNode }) {
  return <SkillsLayout>{children}</SkillsLayout>;
}
