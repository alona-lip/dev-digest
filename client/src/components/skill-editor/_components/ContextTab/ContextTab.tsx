/* ContextTab — a skill's attached project documents (picker) plus the read-only
   "Serializes as" preview of the `## Project specifications` block. Display +
   attachments only: the skill's own prompt block is not touched. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ContextDocsPicker } from "@/components/context-docs-picker";
import { useAttachments } from "@/lib/hooks/project-context";
import { useActiveRepo } from "@/lib/repo-context";
import { serializeSpecs } from "./helpers";
import { s } from "./styles";

export function ContextTab({ skillId }: { skillId: string }) {
  const t = useTranslations("skills.contextTab");
  const { repoId } = useActiveRepo();
  const { data } = useAttachments("skill", skillId, repoId);
  const paths = data?.paths ?? [];

  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("title", { count: paths.length })}</h2>
      <p style={s.sub}>{t("hint")}</p>
      <ContextDocsPicker kind="skill" ownerId={skillId} repoId={repoId} />
      <div style={s.serializesLabel}>{t("serializesAs")}</div>
      {paths.length > 0 ? (
        <pre className="mono" style={s.serializes} aria-label={t("serializesAs")}>
          {serializeSpecs(paths)}
        </pre>
      ) : (
        <p style={s.sub}>{t("serializesEmpty")}</p>
      )}
    </div>
  );
}
