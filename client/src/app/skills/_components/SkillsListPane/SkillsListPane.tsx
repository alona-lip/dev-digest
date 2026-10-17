/* SkillsListPane — left column of /skills/*: title, "Add Skill" (create / import),
   search and the skill cards. A card toggle is the GLOBAL switch for that skill. */
"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { SkillCard, filterSkills } from "../SkillCard";
import { useSkills, useUpdateSkill } from "@/lib/hooks/skills";
import { ImportSkillModal } from "./_components/ImportSkillModal";
import { s } from "./styles";

export function SkillsListPane() {
  const t = useTranslations("skills");
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const [search, setSearch] = React.useState("");
  const [importing, setImporting] = React.useState(false);

  const list = filterSkills(skills ?? [], search);

  return (
    <div style={s.pane}>
      {importing && <ImportSkillModal onClose={() => setImporting(false)} />}
      <div style={s.header}>
        <div style={s.titleRow}>
          <h1 style={s.title}>{t("page.heading")}</h1>
          <Dropdown
            width={210}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("page.addSkill")}
              </Button>
            }
            items={[
              { label: t("page.menu.create"), icon: "Edit", onClick: () => router.push("/skills/new") },
              { label: t("page.menu.importFile"), icon: "Upload", onClick: () => setImporting(true) },
            ]}
          />
        </div>
        <div style={s.search}>
          <Icon.Search size={13} style={s.searchIcon} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("page.searchPlaceholder")}
            aria-label={t("page.searchPlaceholder")}
            style={s.searchInput}
          />
        </div>
      </div>
      <div style={s.list}>
        {isLoading ? (
          <>
            <Skeleton height={110} />
            <Skeleton height={110} />
          </>
        ) : isError ? (
          <ErrorState title={t("page.loadError")} onRetry={() => refetch()} />
        ) : (skills ?? []).length === 0 ? (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => setImporting(true)}
          />
        ) : (
          list.map((sk) => (
            <SkillCard
              key={sk.id}
              skill={sk}
              active={sk.id === params?.id}
              onClick={() => router.push(`/skills/${sk.id}`)}
              onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
            />
          ))
        )}
      </div>
    </div>
  );
}
