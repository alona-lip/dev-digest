/* SkillDraftForm — the editable "Create skill from conventions" form: name, description,
   type, enabled, the agent to link, and the markdown body pre-filled from the ACCEPTED
   candidates. Saves through POST /repos/:id/conventions/skill (new skill or its next
   version + agent link in one request). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Icon, Modal, SelectInput, TextInput, Toggle } from "@devdigest/ui";
import type { AgentListItem, ConventionSkillDraft, SkillType } from "@devdigest/shared";
import { MAX_DESCRIPTION, MAX_NAME, SKILL_TYPES, SkillBodyField, validateSkillForm } from "@/components/skill-form";
import { useCreateConventionSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { defaultAgentId, nextVersion } from "./helpers";
import { s } from "./styles";

export function SkillDraftForm({
  repoId,
  repoName,
  draft,
  agents,
  onClose,
}: {
  repoId: string;
  repoName: string;
  draft: ConventionSkillDraft;
  agents: AgentListItem[];
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const ts = useTranslations("skills");
  const toast = useToast();
  const create = useCreateConventionSkill(repoId);

  // The draft is the initial value only — from here on the form owns the fields.
  const [name, setName] = React.useState(draft.name);
  const [description, setDescription] = React.useState(draft.description);
  const [type, setType] = React.useState<SkillType>(draft.type);
  const [enabled, setEnabled] = React.useState(draft.enabled);
  const [body, setBody] = React.useState(draft.body);
  const [agentId, setAgentId] = React.useState(() => defaultAgentId(agents));
  const [touched, setTouched] = React.useState(false);

  const formError = validateSkillForm({ name, description, body });
  const agentMissing = !agentId;
  const version = nextVersion(draft, name);

  const save = () => {
    setTouched(true);
    if (formError || agentMissing) return;
    const agent = agents.find((a) => a.id === agentId);
    create.mutate(
      { name: name.trim(), description: description.trim(), type, enabled, body, agent_id: agentId },
      {
        onSuccess: (skill) => {
          toast.success(t("modal.createdToast", { name: skill.name, version: skill.version, agent: agent?.name ?? "" }));
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      width={820}
      title={t("modal.title")}
      subtitle={name || draft.name}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <span style={s.savedAs}>
            <Icon.GitCommit size={14} />
            {t("modal.savedAs", { version })}
          </span>
          {touched && (formError || agentMissing) && (
            <span role="alert" style={s.error}>
              {formError ? ts(`editor.errors.${formError}`) : t("modal.agentRequired")}
            </span>
          )}
          <Button kind="secondary" onClick={onClose}>
            {t("modal.cancel")}
          </Button>
          <Button kind="primary" icon="Sparkles" onClick={save} disabled={create.isPending}>
            {create.isPending ? t("modal.creating") : t("modal.create")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.banner} data-testid="conventions-banner">
          <Icon.Wrench size={16} style={s.bannerIcon} />
          <span>
            {t.rich("modal.banner", {
              count: draft.accepted_count,
              repo: repoName,
              b: (chunks) => <strong style={s.bannerStrong}>{chunks}</strong>,
              mono: (chunks) => (
                <span className="mono" style={s.bannerRepo}>
                  {chunks}
                </span>
              ),
            })}
          </span>
        </div>

        <FormField label={ts("editor.name")} required>
          <TextInput value={name} onChange={setName} mono maxLength={MAX_NAME} aria-label={ts("editor.name")} />
        </FormField>
        <FormField label={ts("editor.description")} hint={ts("editor.descriptionHint")} required>
          <TextInput
            value={description}
            onChange={setDescription}
            maxLength={MAX_DESCRIPTION}
            aria-label={ts("editor.description")}
          />
        </FormField>

        <div style={s.row}>
          <FormField label={ts("editor.type")}>
            <SelectInput
              value={type}
              onChange={(v) => setType(v as SkillType)}
              options={SKILL_TYPES.map((v) => ({ value: v, label: ts(`listItem.type.${v}`) }))}
            />
          </FormField>
          <FormField label={t("modal.enabled")} hint={t("modal.enabledHint")}>
            <div style={s.toggleWrap}>
              <Toggle on={enabled} onChange={setEnabled} />
            </div>
          </FormField>
        </div>

        <FormField label={t("modal.agent")} hint={t("modal.agentHint")} required>
          <SelectInput
            value={agentId}
            onChange={setAgentId}
            options={agents.map((a) => ({ value: a.id, label: a.name }))}
            mono={false}
          />
        </FormField>

        <SkillBodyField name={name} value={body} onChange={setBody} unsaved />
      </div>
    </Modal>
  );
}
