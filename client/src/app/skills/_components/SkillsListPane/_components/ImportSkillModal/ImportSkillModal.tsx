/* ImportSkillModal — import a skill from a .md file or a .zip (SKILL.md inside).
   Step 1 picks the file; step 2 shows an editable PREVIEW. Nothing is saved until
   the user confirms. Anything executable in an archive is only listed as ignored —
   the server never reads or runs it. A foreign skill is foreign instructions in an
   agent's prompt, hence the trust banner. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, Icon, Markdown, Modal, SelectInput, TextInput } from "@devdigest/ui";
import type { SkillImportPreview, SkillType } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { useCreateSkill, useImportSkillPreview } from "@/lib/hooks/skills";
import { ACCEPT, MAX_IMPORT_BYTES, SKILL_TYPES } from "./constants";
import { bytesToBase64, hasNameConflict, isImportable, readFileBytes } from "./helpers";
import { s } from "./styles";

export function ImportSkillModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const previewMut = useImportSkillPreview();
  const create = useCreateSkill();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<SkillImportPreview | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");

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
        onSuccess: (p) => {
          setPreview(p);
          setName(p.name);
          setDescription(p.description);
          setType(p.type);
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : t("import.failed")),
      },
    );
  };

  const conflict = preview ? hasNameConflict(preview, name) : false;
  const canSave = !!preview && !!name.trim() && !!description.trim() && !conflict && !create.isPending;

  const save = () => {
    if (!preview) return;
    create.mutate(
      { name: name.trim(), description: description.trim(), type, body: preview.body, source: "imported_file" },
      {
        onSuccess: (skill) => {
          toast.success(t("import.saved", { name: skill.name }));
          onClose();
          router.push(`/skills/${skill.id}`);
        },
      },
    );
  };

  return (
    <Modal
      width={680}
      title={preview ? t("import.previewTitle") : t("import.title")}
      subtitle={preview ? t("import.previewSubtitle") : t("import.subtitle")}
      onClose={onClose}
      footer={
        preview ? (
          <div style={s.footer}>
            <Button kind="secondary" onClick={onClose}>
              {t("import.cancel")}
            </Button>
            <Button kind="primary" icon="Check" onClick={save} disabled={!canSave}>
              {create.isPending ? t("import.saving") : t("import.save")}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div style={s.body}>
        {!preview ? (
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
        ) : (
          <>
            <div style={s.trust} role="note">
              <Icon.AlertTriangle size={16} style={{ flexShrink: 0, color: "var(--warn)" }} />
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
              <div>
                <div style={s.ignoredTitle}>{t("import.ignoredTitle", { count: preview.ignored_files.length })}</div>
                <div style={s.ignoredNote}>{t("import.ignoredNote")}</div>
                {preview.ignored_files.map((f) => (
                  <div key={f.path} style={s.ignoredRow}>
                    <span className="mono" style={{ flex: 1 }}>
                      {f.path}
                    </span>
                    <Badge color={f.reason === "executable" ? "var(--crit)" : "var(--text-secondary)"}>
                      {t(`import.reason.${f.reason}`)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
