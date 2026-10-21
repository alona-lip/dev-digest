/* UrlImportTab — Add skill → Import from URL: an https link to a raw .md or a
   .zip (a github.com "blob" link works too). The SERVER fetches it, behind an
   SSRF guard, and parses it like a file. The result is the same editable
   preview, and the skill is saved disabled until it has been vetted. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, TextInput } from "@devdigest/ui";
import type { SkillImportPreview } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useImportSkillUrlPreview } from "@/lib/hooks/skills";
import { ImportPreviewForm } from "../ImportPreviewForm";
import { s } from "./styles";

export function UrlImportTab({ onDone }: { onDone: () => void }) {
  const t = useTranslations("skills");
  const previewMut = useImportSkillUrlPreview();
  const [url, setUrl] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<SkillImportPreview | null>(null);

  const fetchPreview = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    previewMut.mutate(
      { url: url.trim() },
      {
        onSuccess: setPreview,
        onError: (err) => setError(err instanceof ApiError ? err.message : t("url.failed")),
      },
    );
  };

  if (preview) return <ImportPreviewForm preview={preview} source="imported_url" onDone={onDone} />;

  return (
    <form onSubmit={fetchPreview} style={s.form}>
      <FormField label={t("url.label")} hint={t("url.hint")} required>
        <TextInput value={url} onChange={setUrl} mono placeholder={t("url.placeholder")} />
      </FormField>
      {error && (
        <div role="alert" style={s.error}>
          {error}
        </div>
      )}
      <Button type="submit" kind="primary" size="lg" full disabled={!url.trim() || previewMut.isPending}>
        {previewMut.isPending ? t("url.fetching") : t("url.fetch")}
      </Button>
    </form>
  );
}
