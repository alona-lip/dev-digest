/* CreateSkillFromConventionsModal — Conventions → "Create skill". Loads the skill draft
   the server built from the ACCEPTED candidates (plus the agents to link it to), then
   hands both to the editable form. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Modal, Skeleton } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import { useConventionSkillDraft } from "@/lib/hooks/conventions";
import { SkillDraftForm } from "./_components/SkillDraftForm";
import { s } from "./styles";

export function CreateSkillFromConventionsModal({
  repoId,
  repoName,
  onClose,
}: {
  repoId: string;
  repoName: string;
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const draft = useConventionSkillDraft(repoId);
  const agents = useAgents();

  if (draft.data && agents.data) {
    return <SkillDraftForm repoId={repoId} repoName={repoName} draft={draft.data} agents={agents.data} onClose={onClose} />;
  }

  const failed = draft.isError || agents.isError;
  return (
    <Modal
      width={820}
      title={t("modal.title")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="secondary" onClick={onClose}>
            {t("modal.cancel")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        {failed ? (
          <ErrorState
            title={t("modal.loadError")}
            onRetry={() => {
              void draft.refetch();
              void agents.refetch();
            }}
          />
        ) : (
          <div style={s.skeleton} aria-busy="true">
            <Skeleton height={44} />
            <Skeleton height={40} />
            <Skeleton height={40} />
            <Skeleton height={220} />
          </div>
        )}
      </div>
    </Modal>
  );
}
