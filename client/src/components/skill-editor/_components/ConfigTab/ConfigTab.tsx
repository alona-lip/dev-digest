/* ConfigTab — name · description · type · body (+ enabled switch, delete).
   Create mode (no `skill`) saves with POST and navigates to the new skill.
   Form state is seeded once; the parent keys this by id:version, so a restore or
   a saved body change remounts it with fresh values. The Enabled switch writes
   immediately (same mutation as the list card) so the two can never disagree. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, Markdown, SelectInput, TextInput, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useToast } from "@/lib/toast";
import { useCreateSkill, useDeleteSkill, useUpdateSkill } from "@/lib/hooks/skills";
import { approxTokens, bodyFileName } from "../../helpers";
import { CodeTextarea } from "../CodeTextarea";
import { MAX_DESCRIPTION, MAX_NAME, SKILL_TYPES } from "./constants";
import { validateSkillForm } from "./helpers";
import { s } from "./styles";

export function ConfigTab({ skill }: { skill?: Skill }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const create = useCreateSkill();
  const update = useUpdateSkill();
  const del = useDeleteSkill();

  const [name, setName] = React.useState(skill?.name ?? "");
  const [description, setDescription] = React.useState(skill?.description ?? "");
  const [type, setType] = React.useState<SkillType>(skill?.type ?? "custom");
  const [body, setBody] = React.useState(skill?.body ?? "");
  const [note, setNote] = React.useState("");
  const [enabledNew, setEnabledNew] = React.useState(true);
  const [showPreview, setShowPreview] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  const bodyChanged = skill ? body !== skill.body : body.length > 0;
  const dirty =
    !skill ||
    name !== skill.name ||
    description !== skill.description ||
    type !== skill.type ||
    body !== skill.body;
  const error = validateSkillForm({ name, description, body });
  const saving = create.isPending || update.isPending;
  // Saved body → exact server count; edited body → an estimate, marked with "~".
  const tokensLabel =
    skill && !bodyChanged
      ? t("editor.tokens", { count: skill.tokens })
      : t("editor.tokensApprox", { count: approxTokens(body) });

  const save = () => {
    setTouched(true);
    if (error) return;
    if (!skill) {
      create.mutate(
        { name: name.trim(), description: description.trim(), type, body, enabled: enabledNew },
        {
          onSuccess: (created) => {
            toast.success(t("editor.createdToast", { name: created.name }));
            router.push(`/skills/${created.id}`);
          },
        },
      );
      return;
    }
    update.mutate(
      {
        id: skill.id,
        patch: {
          name: name.trim(),
          description: description.trim(),
          type,
          body,
          ...(bodyChanged && note.trim() ? { change_note: note.trim() } : {}),
        },
      },
      { onSuccess: (saved) => toast.success(t("editor.savedToast", { version: saved.version })) },
    );
  };

  const cancel = () => {
    if (!skill) return router.push("/skills");
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
    setNote("");
    setTouched(false);
  };

  const remove = () => {
    if (!skill) return;
    if (!window.confirm(t("editor.deleteConfirm", { name: skill.name }))) return;
    del.mutate(skill.id, { onSuccess: () => router.push("/skills") });
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("editor.configTitle")}</h2>
        {skill && <Badge icon="GitCommit" mono>{t("preview.version", { version: skill.version })}</Badge>}
        <label style={s.enabledLabel}>
          {t("preview.enabled")}
          <Toggle
            on={skill ? skill.enabled : enabledNew}
            onChange={(v) => (skill ? update.mutate({ id: skill.id, patch: { enabled: v } }) : setEnabledNew(v))}
            size={16}
          />
        </label>
      </div>

      <FormField label={t("editor.name")} required>
        <TextInput value={name} onChange={setName} mono maxLength={MAX_NAME} />
      </FormField>
      <FormField label={t("editor.description")} hint={t("editor.descriptionHint")} required>
        <TextInput value={description} onChange={setDescription} maxLength={MAX_DESCRIPTION} />
      </FormField>
      <FormField label={t("editor.type")}>
        <SelectInput
          value={type}
          onChange={(v) => setType(v as SkillType)}
          options={SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
        />
      </FormField>
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
            <Markdown>{body}</Markdown>
          </div>
        ) : (
          <CodeTextarea
            value={body}
            onChange={setBody}
            fileName={bodyFileName(name)}
            unsaved={!!skill && bodyChanged}
            unsavedLabel={t("editor.unsaved")}
            tokensLabel={tokensLabel}
            ariaLabel={t("editor.body")}
          />
        )}
      </FormField>
      {skill && bodyChanged && (
        <FormField label={t("editor.changeNote")} hint={t("editor.changeNoteHint")}>
          <TextInput value={note} onChange={setNote} maxLength={200} placeholder={t("editor.changeNotePlaceholder")} />
        </FormField>
      )}

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={saving || (!!skill && !dirty)}>
          {saving ? t("editor.saving") : skill ? t("editor.save") : t("editor.create")}
        </Button>
        <Button kind="secondary" onClick={cancel} disabled={saving}>
          {t("editor.cancel")}
        </Button>
        {touched && error && (
          <span role="alert" style={s.error}>
            {t(`editor.errors.${error}`)}
          </span>
        )}
        <span style={s.spacer} />
        {skill && (
          <Button kind="danger" icon="Trash" onClick={remove} disabled={del.isPending}>
            {t("editor.delete")}
          </Button>
        )}
      </div>
    </div>
  );
}
