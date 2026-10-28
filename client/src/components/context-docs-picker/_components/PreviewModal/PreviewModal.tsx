/* PreviewModal — the full rendered text of one document. Read-only: it never
   touches the attachments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Skeleton } from "@devdigest/ui";
import { MarkdownPreview } from "@/components/markdown-preview";
import { useContextDoc } from "@/lib/hooks/project-context";
import { useDialogFocus } from "@/lib/dialog-focus";
import { s } from "../../styles";

export function PreviewModal({
  repoId,
  path,
  onClose,
}: {
  repoId: string;
  path: string;
  onClose: () => void;
}) {
  const t = useTranslations("context");
  const doc = useContextDoc(repoId, path);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  useDialogFocus(bodyRef, onClose);

  return (
    <Modal width={760} title={<span className="mono">{path}</span>} onClose={onClose}>
      <div ref={bodyRef} style={s.previewBody}>
        {doc.isLoading ? (
          <Skeleton height={160} />
        ) : doc.isError || !doc.data ? (
          <p role="alert">{t("picker.previewError")}</p>
        ) : (
          <MarkdownPreview>{doc.data.content}</MarkdownPreview>
        )}
      </div>
    </Modal>
  );
}
