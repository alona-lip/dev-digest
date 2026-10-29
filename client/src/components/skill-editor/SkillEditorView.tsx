/* SkillEditorView — right pane of /skills/:id. Header (name, type, version,
   Re-scan) + tabs Config · Preview · Evals · Stats · Versions · Context (tab in ?tab=).
   A skill blocked by the prompt-injection scan gets the red banner and badge.
   Creating a skill is the Add skill modal in the list pane, not a route. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Icon, Skeleton, Tabs } from "@devdigest/ui";
import { SkillScanBanner } from "@/components/skill-scan-banner";
import { SkillTypeBadge } from "@/components/skill-type-badge";
import { ApiError } from "@/lib/api";
import { useRescanSkill, useSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { ContextTab } from "./_components/ContextTab";
import { ConfigTab } from "./_components/ConfigTab";
import { EvalsTab } from "./_components/EvalsTab";
import { PreviewTab } from "./_components/PreviewTab";
import { StatsTab } from "./_components/StatsTab";
import { VersionsTab } from "./_components/VersionsTab";
import { TABS } from "./constants";
import { parseTabParam } from "./helpers";
import { s } from "./styles";

export function SkillEditorView({ id }: { id: string }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const search = useSearchParams();
  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);
  const rescan = useRescanSkill();
  const toast = useToast();

  const tab = parseTabParam(search.get("tab"));
  const setTab = (next: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", next);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

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
  const blocked = skill.scan.status === "injection";
  const runRescan = () =>
    rescan.mutate(skill.id, {
      onSuccess: (next) =>
        next.scan.status === "injection" ? toast.error(t("scan.rescanBlocked")) : toast.success(t("scan.rescanClean")),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : t("scan.rescanFailed")),
    });
  return (
    <>
      <SkillScanBanner scan={skill.scan} />
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
        {blocked && (
          <Badge icon="AlertOctagon" color="var(--crit)" bg="var(--crit-bg)">
            {t("scan.badge")}
          </Badge>
        )}
        <div style={s.actions}>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            loading={rescan.isPending}
            disabled={rescan.isPending}
            onClick={runRescan}
            title={t("scan.rescanTitle")}
          >
            {t("scan.rescan")}
          </Button>
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
        {tab === "context" && <ContextTab skillId={skill.id} />}
      </div>
    </>
  );
}
