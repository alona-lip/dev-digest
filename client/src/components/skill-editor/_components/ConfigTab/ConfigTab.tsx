/* ConfigTab — name · description · type · body (+ enabled switch, delete) of an
   existing skill. Creating a skill is the Create-skill modal on /skills.
   Form state is seeded once; the parent keys this by id:version, so a restore or
   a saved body change remounts it with fresh values. The Enabled switch writes
   immediately (same mutation as the list card) so the two can never disagree. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, SelectInput, TextInput, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/lib/toast";
import { useDeleteSkill, useUpdateSkill } from "@/lib/hooks/skills";
import {
  MAX_DESCRIPTION,
  MAX_NAME,
  SKILL_TYPES,
  SkillBodyField,
  approxTokens,
  validateSkillForm,
} from "@/components/skill-form";
import { s } from "./styles";

export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const update = useUpdateSkill();
  const del = useDeleteSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [note, setNote] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const bodyChanged = body !== skill.body;
  const dirty =
    name !== skill.name || description !== skill.description || type !== skill.type || body !== skill.body;
  const error = validateSkillForm({ name, description, body });
  const saving = update.isPending;
  // Saved body → exact server count; edited body → an estimate, marked with "~".
  const tokensLabel = bodyChanged
    ? t("editor.tokensApprox", { count: approxTokens(body) })
    : t("editor.tokens", { count: skill.tokens });

  const save = () => {
    setTouched(true);
    if (error) return;
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
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
    setNote("");
    setTouched(false);
  };

  const remove = () =>
    del.mutate(skill.id, {
      onSuccess: () => {
        setConfirmDelete(false);
        router.push("/skills");
      },
    });

  return (
    <div style={s.wrap}>
      {confirmDelete && (
        <ConfirmDialog
          title={t("editor.deleteTitle", { name: skill.name })}
          body={t("editor.deleteConfirm", { name: skill.name })}
          pending={del.isPending}
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      )}
      <div style={s.header}>
        <h2 style={s.h2}>{t("editor.configTitle")}</h2>
        <Badge icon="GitCommit" mono>
          {t("preview.version", { version: skill.version })}
        </Badge>
        <label style={s.enabledLabel}>
          {t("preview.enabled")}
          <Toggle
            on={skill.enabled}
            onChange={(v) => update.mutate({ id: skill.id, patch: { enabled: v } })}
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
      <SkillBodyField
        name={name}
        value={body}
        onChange={setBody}
        unsaved={bodyChanged}
        tokensLabel={tokensLabel}
      />
      {bodyChanged && (
        <FormField label={t("editor.changeNote")} hint={t("editor.changeNoteHint")}>
          <TextInput value={note} onChange={setNote} maxLength={200} placeholder={t("editor.changeNotePlaceholder")} />
        </FormField>
      )}

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={saving || !dirty}>
          {saving ? t("editor.saving") : t("editor.save")}
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
        <Button kind="danger" icon="Trash" onClick={() => setConfirmDelete(true)} disabled={del.isPending}>
          {t("editor.delete")}
        </Button>
      </div>
    </div>
  );
}
