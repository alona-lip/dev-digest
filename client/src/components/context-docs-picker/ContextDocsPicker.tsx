/* ContextDocsPicker — attach a repo's `.md` documents to an agent or a skill.
   One component for both owners (`kind`). Every toggle / reorder saves the WHOLE
   ordered path list at once (optimistic, rolled back on error), keyed by path, so
   attachments hidden by the filter are kept. On an agent it also shows the
   documents inherited through skills (locked), the effective token total and a
   budget warning. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { PROJECT_CONTEXT_TOKEN_BUDGET } from "@devdigest/shared";
import { ErrorState, Icon, Skeleton } from "@devdigest/ui";
import {
  useAttachments,
  useContextDocs,
  useSaveAttachments,
  type ContextOwnerKind,
} from "@/lib/hooks/project-context";
import {
  applyBudget,
  effectiveSet,
  filterRows,
  inheritedRows,
  mergeRows,
  movePath,
  sumTokens,
  togglePath,
} from "./helpers";
import { DocRow } from "./_components/DocRow";
import { PreviewModal } from "./_components/PreviewModal";
import { s } from "./styles";

export interface ContextDocsPickerProps {
  kind: ContextOwnerKind;
  ownerId: string;
  /** The active repository; `null` shows a hint and no checkboxes. */
  repoId: string | null;
}

export function ContextDocsPicker({ kind, ownerId, repoId }: ContextDocsPickerProps) {
  const t = useTranslations("context");
  const docs = useContextDocs(repoId);
  const attachments = useAttachments(kind, ownerId, repoId);
  const save = useSaveAttachments(kind, ownerId, repoId);
  const [filter, setFilter] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const [dragPath, setDragPath] = React.useState<string | null>(null);

  if (!repoId) return <p style={s.hint}>{t("picker.noRepo")}</p>;
  if (docs.isLoading || attachments.isLoading) return <Skeleton height={240} />;
  if (docs.isError || attachments.isError || !docs.data || !attachments.data) {
    return (
      <ErrorState
        title={t("picker.loadError")}
        onRetry={() => {
          void docs.refetch();
          void attachments.refetch();
        }}
      />
    );
  }
  if (docs.data.status === "not_cloned") return <p style={s.hint}>{t("picker.notCloned")}</p>;

  const paths = attachments.data.paths;
  const rows = mergeRows(docs.data.docs, attachments.data);
  const ownRows = rows.filter((r) => r.attached);
  const inherited = kind === "agent" ? inheritedRows(attachments.data) : [];
  const inheritedPaths = new Set(inherited.map((r) => r.path));
  // An inherited document is shown once, as its locked row.
  const restRows = rows.filter((r) => !r.attached && !inheritedPaths.has(r.path));
  const orderable = filter.trim() === "";
  const commit = (next: string[]) => save.mutate(next);

  const visibleOwn = filterRows(ownRows, filter);
  const visibleInherited = filterRows(inherited, filter);
  const visibleRest = filterRows(restRows, filter);
  const nothingVisible = visibleOwn.length + visibleInherited.length + visibleRest.length === 0;

  const set = effectiveSet(attachments.data);
  const overBudget = applyBudget(set)
    .filter((r) => r.status === "over_budget")
    .map((r) => r.path);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <span style={s.count}>
          {t("picker.attachedCount", { attached: ownRows.length, total: rows.length })}
        </span>
        <div style={s.filter}>
          <Icon.Search size={13} style={s.filterIcon} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("picker.filterPlaceholder")}
            aria-label={t("picker.filterPlaceholder")}
            style={s.filterInput}
          />
        </div>
      </div>
      <p style={s.hint}>{t("picker.orderHint")}</p>
      {save.isError && (
        <p role="alert" style={s.error}>
          {t("picker.saveError")}
        </p>
      )}

      {rows.length === 0 && inherited.length === 0 && <div style={s.empty}>{t("picker.empty")}</div>}
      {rows.length + inherited.length > 0 && nothingVisible && (
        <div style={s.empty}>{t("picker.noMatches")}</div>
      )}

      {visibleOwn.map((r) => {
        const index = paths.indexOf(r.path);
        return (
          <DocRow
            key={r.path}
            row={r}
            checked
            inOrder
            orderable={orderable}
            dragging={dragPath === r.path}
            isFirst={index === 0}
            isLast={index === paths.length - 1}
            onToggle={() => commit(togglePath(paths, r.path))}
            onPreview={() => setPreviewPath(r.path)}
            onMove={(delta) => {
              const to = paths[index + delta];
              if (to) commit(movePath(paths, r.path, to));
            }}
            onDragStart={() => setDragPath(r.path)}
            onDragEnd={() => setDragPath(null)}
            onDrop={() => {
              const from = dragPath;
              setDragPath(null);
              if (from && from !== r.path) commit(movePath(paths, from, r.path));
            }}
          />
        );
      })}

      {visibleInherited.map((r) => (
        <DocRow
          key={`via:${r.path}`}
          row={r}
          checked
          inheritedFrom={r.via_skill.name}
          inOrder={false}
          orderable={false}
          dragging={false}
          isFirst
          isLast
          onToggle={() => undefined}
          onPreview={() => setPreviewPath(r.path)}
          onMove={() => undefined}
          onDragStart={() => undefined}
          onDragEnd={() => undefined}
          onDrop={() => undefined}
        />
      ))}

      {visibleRest.map((r) => (
        <DocRow
          key={r.path}
          row={r}
          checked={false}
          inOrder={false}
          orderable={false}
          dragging={false}
          isFirst
          isLast
          onToggle={() => commit(togglePath(paths, r.path))}
          onPreview={() => setPreviewPath(r.path)}
          onMove={() => undefined}
          onDragStart={() => undefined}
          onDragEnd={() => undefined}
          onDrop={() => undefined}
        />
      ))}

      {kind === "agent" && (
        <>
          {overBudget.length > 0 && (
            <p role="status" style={s.warning}>
              {t("picker.budgetWarning", {
                budget: PROJECT_CONTEXT_TOKEN_BUDGET.toLocaleString("en-US"),
                names: overBudget.join(", "),
              })}
            </p>
          )}
          <div style={s.footer}>{t("picker.tokensTotal", { count: sumTokens(set).toLocaleString("en-US") })}</div>
        </>
      )}

      {previewPath && <PreviewModal repoId={repoId} path={previewPath} onClose={() => setPreviewPath(null)} />}
    </div>
  );
}
