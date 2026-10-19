/* SkillsListPane — left column of /skills/*: title, "Add Skill" (create / import,
   both modals), search and the skill cards. A card toggle is the GLOBAL switch for
   that skill; a card's Delete asks for confirmation first. */
"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { SkillListItem } from "@devdigest/shared";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SkillCard, filterSkills } from "../SkillCard";
import { useDeleteSkill, useSkills, useUpdateSkill } from "@/lib/hooks/skills";
import { CreateSkillModal } from "./_components/CreateSkillModal";
import { ImportSkillModal } from "./_components/ImportSkillModal";
import { s } from "./styles";

export function SkillsListPane() {
  const t = useTranslations("skills");
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const del = useDeleteSkill();
  const [search, setSearch] = React.useState("");
  const [importing, setImporting] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [deleting, setDeleting] = React.useState<SkillListItem | null>(null);

  const list = filterSkills(skills ?? [], search);

  return (
    <div style={s.pane}>
      {importing && <ImportSkillModal onClose={() => setImporting(false)} />}
      {creating && <CreateSkillModal onClose={() => setCreating(false)} />}
      {deleting && (
        <ConfirmDialog
          title={t("editor.deleteTitle", { name: deleting.name })}
          body={t("editor.deleteConfirm", { name: deleting.name })}
          pending={del.isPending}
          onClose={() => setDeleting(null)}
          onConfirm={() =>
            del.mutate(deleting.id, {
              onSuccess: () => {
                if (deleting.id === params?.id) router.push("/skills");
                setDeleting(null);
              },
            })
          }
        />
      )}
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
              { label: t("page.menu.create"), icon: "Edit", onClick: () => setCreating(true) },
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
              onDelete={() => setDeleting(sk)}
            />
          ))
        )}
      </div>
    </div>
  );
}
