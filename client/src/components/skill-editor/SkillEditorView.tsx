/* SkillEditorView — right pane of /skills/new and /skills/:id. Header (name,
   type, version) + tabs Config · Preview · Evals · Stats · Versions (tab in ?tab=).
   `id` undefined = create mode: Config only, no header/tabs of an existing skill. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Icon, Skeleton, Tabs } from "@devdigest/ui";
import { SkillTypeBadge } from "@/components/skill-type-badge";
import { ApiError } from "@/lib/api";
import { useSkill } from "@/lib/hooks/skills";
import { ConfigTab } from "./_components/ConfigTab";
import { EvalsTab } from "./_components/EvalsTab";
import { PreviewTab } from "./_components/PreviewTab";
import { StatsTab } from "./_components/StatsTab";
import { VersionsTab } from "./_components/VersionsTab";
import { TABS } from "./constants";
import { parseTabParam } from "./helpers";
import { s } from "./styles";

export function SkillEditorView({ id }: { id?: string }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const search = useSearchParams();
  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);

  const tab = parseTabParam(search.get("tab"));
  const setTab = (next: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", next);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  // ---- create mode ----
  if (!id) {
    return (
      <>
        <div style={s.header}>
          <div style={s.icon}>
            <Icon.Sparkles size={16} />
          </div>
          <h1 style={s.title}>{t("editor.newTitle")}</h1>
        </div>
        <div style={s.body}>
          <ConfigTab />
        </div>
      </>
    );
  }

  if (isError || (!isLoading && !skill)) {
    return (
      <ErrorState
        title={t("detail.notFound.title")}
        body={error instanceof ApiError ? error.message : t("detail.notFound.body")}
        onRetry={() => refetch()}
      />
    );
  }
  if (isLoading || !skill) {
    return (
      <div style={s.skeleton}>
        <Skeleton height={24} width={240} />
        <Skeleton height={240} />
      </div>
    );
  }

  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(`tabs.${tb.key}`), icon: tb.icon }));
  return (
    <>
      <div style={s.header}>
        <div style={s.icon}>
          <Icon.Sparkles size={16} />
        </div>
        <h1 className="mono" style={s.title}>
          {skill.name}
        </h1>
        <SkillTypeBadge type={skill.type} />
        <Badge icon="GitCommit" mono>
          {t("preview.version", { version: skill.version })}
        </Badge>
        <div style={s.actions}>
          {/* Evals are a later lesson — visible for the layout, not wired. */}
          <Button kind="secondary" size="sm" icon="Play" disabled title={t("evals.comingSoon")}>
            {t("editor.runOnEvals")}
          </Button>
        </div>
      </div>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={setTab} pad="0 24px" />
      </div>
      <div style={s.body}>
        {tab === "config" && <ConfigTab key={`${skill.id}:${skill.version}`} skill={skill} />}
        {tab === "preview" && <PreviewTab skill={skill} />}
        {tab === "evals" && <EvalsTab />}
        {tab === "stats" && <StatsTab skillId={skill.id} />}
        {tab === "versions" && <VersionsTab skill={skill} />}
      </div>
    </>
  );
}
