/* SkillsLayout — AppShell + the persistent skill list (left) + the routed pane (right). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { SkillsListPane } from "../SkillsListPane";
import { s } from "./styles";

export function SkillsLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("skills");
  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      <div style={s.layout}>
        <SkillsListPane />
        <div style={s.detail}>{children}</div>
      </div>
    </AppShell>
  );
}
