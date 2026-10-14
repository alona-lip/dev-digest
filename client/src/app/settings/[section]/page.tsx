import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SETTINGS_SECTIONS } from "@devdigest/ui/nav";
import { SettingsView } from "./_components/SettingsView";

/* Route: /settings/:section. Thin server entry — resolves the section (an
   unknown one is a real 404, not a silent fallback to the first section) and
   names the tab; the view, its panels, styles, constants and i18n are
   colocated under _components/SettingsView. */

type Params = Promise<{ section: string }>;

function findSection(key: string) {
  return SETTINGS_SECTIONS.find((sec) => sec.key === key);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { section } = await params;
  return { title: findSection(section)?.label ?? "Settings" };
}

export default async function SettingsPage({ params }: { params: Params }) {
  const { section } = await params;
  if (!findSection(section)) notFound();
  return <SettingsView section={section} />;
}
