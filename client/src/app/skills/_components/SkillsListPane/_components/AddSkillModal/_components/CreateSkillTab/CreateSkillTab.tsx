/* CreateSkillTab — Add skill → Create: name, description, type and the markdown
   body (Edit / Preview), validated with the same rules as the editor's Config
   tab. Saves with POST /skills and opens the new skill. A body that fails the
   injection scan is still created, but blocked: the toast says so. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, FormField, SelectInput, TextInput } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { MAX_DESCRIPTION, MAX_NAME, SKILL_TYPES, SkillBodyField, validateSkillForm } from "@/components/skill-form";
import { useToast } from "@/lib/toast";
import { useCreateSkill } from "@/lib/hooks/skills";
import { s } from "./styles";

export function CreateSkillTab({ onDone }: { onDone: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  const error = validateSkillForm({ name, description, body });

  const save = () => {
    setTouched(true);
    if (error) return;
    create.mutate(
      { name: name.trim(), description: description.trim(), type, body, source: "manual" },
      {
        onSuccess: (skill) => {
          if (skill.scan.status === "injection") toast.error(t("scan.savedBlocked", { name: skill.name }));
          else toast.success(t("editor.createdToast", { name: skill.name }));
          onDone();
          router.push(`/skills/${skill.id}`);
        },
      },
    );
  };

  return (
    <div style={s.form}>
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
      <SkillBodyField name={name} value={body} onChange={setBody} />
      {touched && error && (
        <div role="alert" style={s.error}>
          {t(`editor.errors.${error}`)}
        </div>
      )}
      <Button kind="primary" size="lg" full onClick={save} disabled={create.isPending}>
        {create.isPending ? t("create.saving") : t("create.save")}
      </Button>
    </div>
  );
}
