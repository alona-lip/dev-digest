/* FileImportTab — Add skill → From file: a .md, or a .zip with a SKILL.md.
   Picking a file asks the server for a PREVIEW (ImportPreviewForm); nothing is
   saved until the user confirms there. Anything executable in an archive is
   only listed as ignored: the server never reads or runs it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { SkillImportPreview } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useImportSkillPreview } from "@/lib/hooks/skills";
import { ImportPreviewForm } from "../ImportPreviewForm";
import { ACCEPT, MAX_IMPORT_BYTES } from "./constants";
import { bytesToBase64, isImportable, readFileBytes } from "./helpers";
import { s } from "./styles";

export function FileImportTab({ onDone }: { onDone: () => void }) {
  const t = useTranslations("skills");
  const previewMut = useImportSkillPreview();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<SkillImportPreview | null>(null);

  const pick = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!isImportable(file.name)) return setError(t("import.badType"));
    if (file.size > MAX_IMPORT_BYTES) return setError(t("import.tooLarge", { kb: MAX_IMPORT_BYTES / 1024 }));
    let bytes: Uint8Array;
    try {
      bytes = await readFileBytes(file);
    } catch {
      return setError(t("import.failed"));
    }
    previewMut.mutate(
      { filename: file.name, content_base64: bytesToBase64(bytes) },
      {
        onSuccess: setPreview,
        onError: (e) => setError(e instanceof ApiError ? e.message : t("import.failed")),
      },
    );
  };

  if (preview) return <ImportPreviewForm preview={preview} source="imported_file" onDone={onDone} />;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        style={s.drop(over)}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void pick(e.dataTransfer.files[0]);
        }}
      >
        <Icon.Upload size={22} />
        <span>{previewMut.isPending ? t("import.reading") : t("import.drop")}</span>
        <span style={s.hint}>{t("import.dropHint")}</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        data-testid="skill-file-input"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      {error && (
        <div role="alert" style={s.error}>
          {error}
        </div>
      )}
    </>
  );
}
