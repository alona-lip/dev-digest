/* SkillBodyField — the markdown body of a skill with an Edit / Preview switch.
   Used by the editor's Config tab and by the Create-skill modal, so both write the
   body the same way. Without `tokensLabel` it shows the chars/4 estimate. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, Markdown } from "@devdigest/ui";
import { approxTokens, bodyFileName } from "./helpers";
import { CodeTextarea } from "./_components/CodeTextarea";
import { s } from "./styles";

export function SkillBodyField({
  name,
  value,
  onChange,
  unsaved = false,
  tokensLabel,
}: {
  /** The skill name; only used for the file name on the editor header. */
  name: string;
  value: string;
  onChange: (v: string) => void;
  unsaved?: boolean;
  tokensLabel?: string;
}) {
  const t = useTranslations("skills");
  const [showPreview, setShowPreview] = React.useState(false);

  return (
    <FormField
      label={t("editor.body")}
      hint={t("editor.bodyHint")}
      required
      right={
        <div style={s.modes}>
          <button type="button" style={s.mode(!showPreview)} onClick={() => setShowPreview(false)}>
            {t("editor.modeEdit")}
          </button>
          <button type="button" style={s.mode(showPreview)} onClick={() => setShowPreview(true)}>
            {t("editor.modePreview")}
          </button>
        </div>
      }
    >
      {showPreview ? (
        <div style={s.preview}>
          <Markdown>{value}</Markdown>
        </div>
      ) : (
        <CodeTextarea
          value={value}
          onChange={onChange}
          fileName={bodyFileName(name)}
          unsaved={unsaved}
          unsavedLabel={t("editor.unsaved")}
          tokensLabel={tokensLabel ?? t("editor.tokensApprox", { count: approxTokens(value) })}
          ariaLabel={t("editor.body")}
        />
      )}
    </FormField>
  );
}
