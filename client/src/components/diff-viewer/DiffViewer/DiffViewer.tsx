/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import { resolveTarget } from "../helpers";
import { s } from "../styles";
import { FileCard } from "../FileCard";

export function DiffViewer({
  files,
  commenting,
  target,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** Deep-link target: opens, scrolls to and highlights this file/line. */
  target?: { file: string; line: number | null };
}) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  const resolved = target ? resolveTarget(files, target) : null;
  return (
    <div style={s.list}>
      {files.map((f) => {
        const isTarget = resolved?.file === f.path;
        return (
        // Keyed by path, not index: FileCard holds its own open/closed state,
        // which must stay with its file when the list changes.
        <FileCard
          key={f.path}
          file={f}
          commenting={commenting}
          forceOpen={isTarget}
          highlightLine={isTarget ? resolved.lineIndex : null}
        />
        );
      })}
    </div>
  );
}
