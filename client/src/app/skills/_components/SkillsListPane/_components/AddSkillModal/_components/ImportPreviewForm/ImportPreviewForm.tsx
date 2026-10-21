/* ImportPreviewForm — the step both imports share (From file, Import from URL):
   an editable preview of what the server parsed. Nothing is saved until Save.
   A foreign skill is foreign instructions in an agent's prompt, hence the trust
   note, and the injection banner when the scan flags the body (it will then be
   saved blocked). A URL import is always saved disabled, until it is vetted. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, Icon, Markdown, SelectInput, TextInput } from "@devdigest/ui";
import type { SkillImportPreview, SkillType } from "@devdigest/shared";
import { SKILL_TYPES } from "@/components/skill-form";
import { SkillScanBanner } from "@/components/skill-scan-banner";
import { useToast } from "@/lib/toast";
import { useCreateSkill } from "@/lib/hooks/skills";
import { hasNameConflict } from "./helpers";
import { s } from "./styles";

export function ImportPreviewForm({
  preview,
  source,
  onDone,
}: {
  preview: SkillImportPreview;
  source: "imported_file" | "imported_url";
  onDone: () => void;
}) {
  const t = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const create = useCreateSkill();
  const [name, setName] = React.useState(preview.name);
  const [description, setDescription] = React.useState(preview.description);
  const [type, setType] = React.useState<SkillType>(preview.type);

  const conflict = hasNameConflict(preview, name);
  const canSave = !!name.trim() && !!description.trim() && !conflict && !create.isPending;

  const save = () =>
    create.mutate(
      {
        name: name.trim(),
        description: description.trim(),
        type,
        body: preview.body,
        source,
        ...(source === "imported_url" ? { enabled: false } : {}),
      },
      {
        onSuccess: (skill) => {
          if (skill.scan.status === "injection") toast.error(t("scan.savedBlocked", { name: skill.name }));
          else toast.success(source === "imported_url" ? t("url.success", { name: skill.name }) : t("import.saved", { name: skill.name }));
          onDone();
          router.push(`/skills/${skill.id}`);
        },
      },
    );

  return (
    <div>
      <SkillScanBanner scan={preview.scan} body={t("scan.previewBody")} style={s.scan} />
      <div style={s.trust} role="note">
        <Icon.AlertTriangle size={16} style={s.trustIcon} />
        <span>{t("import.trustNotice")}</span>
      </div>
      <div style={s.source}>{t("import.source", { file: preview.source_file })}</div>
      <FormField label={t("editor.name")} required>
        <TextInput value={name} onChange={setName} mono />
      </FormField>
      {conflict && <div style={s.conflict}>{t("import.nameConflict")}</div>}
      <FormField label={t("editor.description")} hint={t("editor.descriptionHint")} required>
        <TextInput value={description} onChange={setDescription} />
      </FormField>
      <FormField label={t("editor.type")}>
        <SelectInput
          value={type}
          onChange={(v) => setType(v as SkillType)}
          options={SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
        />
      </FormField>
      <FormField label={t("import.bodyPreview")}>
        <div style={s.bodyPreview}>
          <Markdown>{preview.body}</Markdown>
        </div>
      </FormField>
      {preview.warnings.length > 0 && (
        <ul style={s.warnList}>
          {preview.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {preview.ignored_files.length > 0 && (
        <div style={s.ignored}>
          <div style={s.ignoredTitle}>{t("import.ignoredTitle", { count: preview.ignored_files.length })}</div>
          <div style={s.ignoredNote}>{t("import.ignoredNote")}</div>
          {preview.ignored_files.map((f) => (
            <div key={f.path} style={s.ignoredRow}>
              <span className="mono" style={s.ignoredPath}>
                {f.path}
              </span>
              <Badge color={f.reason === "executable" ? "var(--crit)" : "var(--text-secondary)"}>
                {t(`import.reason.${f.reason}`)}
              </Badge>
            </div>
          ))}
        </div>
      )}
      <Button kind="primary" size="lg" full onClick={save} disabled={!canSave}>
        {create.isPending ? t("import.saving") : t("import.save")}
      </Button>
    </div>
  );
}
