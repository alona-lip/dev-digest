/* VersionsTab — every saved body is a snapshot (so eval runs stay reproducible).
   Diff compares a version with the current body; Restore never rewrites history —
   it saves the old body as a NEW version. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useToast } from "@/lib/toast";
import { useRestoreSkillVersion, useSkillVersions } from "@/lib/hooks/skills";
import { lineDiff, shortDate } from "./helpers";
import { s } from "./styles";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [open, setOpen] = React.useState<number | null>(null);

  if (isLoading) return <Skeleton height={240} />;
  if (isError || !versions) return <ErrorState title={t("versions.loadError")} onRetry={() => refetch()} />;

  const doRestore = (version: number) => {
    if (!window.confirm(t("versions.restoreConfirm", { version }))) return;
    restore.mutate(
      { id: skill.id, version },
      { onSuccess: (s2) => toast.success(t("versions.restoredToast", { from: version, to: s2.version })) },
    );
  };

  return (
    <div style={s.wrap}>
      <div style={s.titleRow}>
        <h2 style={s.h2}>{t("versions.title")}</h2>
        <Badge>{t("versions.count", { count: versions.length })}</Badge>
      </div>
      <p style={s.sub}>{t("versions.subtitle")}</p>
      {versions.map((v) => (
        <div key={v.version} style={s.row}>
          <div style={s.rowMain}>
            <span className="mono" style={s.ver}>
              v{v.version}
            </span>
            <div style={s.text}>
              <div style={s.message}>{v.message || t("versions.noNote")}</div>
              <div style={s.date}>{shortDate(v.created_at)}</div>
            </div>
            {v.current ? (
              <span style={s.current}>
                <span style={s.dot} />
                {t("versions.current")}
              </span>
            ) : (
              <div style={s.btns}>
                <Button
                  kind="secondary"
                  size="sm"
                  icon="Eye"
                  onClick={() => setOpen(open === v.version ? null : v.version)}
                  aria-expanded={open === v.version}
                >
                  {t("versions.diff")}
                </Button>
                <Button kind="secondary" size="sm" icon="History" onClick={() => doRestore(v.version)} disabled={restore.isPending}>
                  {t("versions.restore")}
                </Button>
              </div>
            )}
          </div>
          {open === v.version && (
            <pre className="mono" style={s.diff} aria-label={t("versions.diffLabel", { version: v.version })}>
              {lineDiff(v.body, skill.body).map((l, i) => (
                <div key={i} style={s.diffLine(l.kind)}>
                  {l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  "}
                  {l.text}
                </div>
              ))}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
