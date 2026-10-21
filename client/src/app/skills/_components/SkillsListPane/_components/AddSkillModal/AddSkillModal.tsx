/* AddSkillModal — "+ Add Skill": one modal, three tabs. Create (write it here),
   From file (.md / .zip) and Import from URL (fetched server-side). Only the
   active tab is mounted, so switching tabs starts that tab fresh. Each tab ends
   with its own full-width action; the modal closes with ✕. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Tabs } from "@devdigest/ui";
import { ADD_SKILL_TABS, type AddSkillTab } from "./constants";
import { CreateSkillTab } from "./_components/CreateSkillTab";
import { FileImportTab } from "./_components/FileImportTab";
import { UrlImportTab } from "./_components/UrlImportTab";
import { s } from "./styles";

export function AddSkillModal({
  initialTab = "create",
  onClose,
}: {
  initialTab?: AddSkillTab;
  onClose: () => void;
}) {
  const t = useTranslations("skills");
  const [tab, setTab] = React.useState<AddSkillTab>(initialTab);
  const tabs = ADD_SKILL_TABS.map((key) => ({ key, label: t(`add.tabs.${key}`) }));

  return (
    <Modal width={640} title={t("add.title")} onClose={onClose}>
      <Tabs tabs={tabs} value={tab} onChange={(k) => setTab(k as AddSkillTab)} pad="0 24px" />
      <div style={s.body}>
        {tab === "create" && <CreateSkillTab onDone={onClose} />}
        {tab === "file" && <FileImportTab onDone={onClose} />}
        {tab === "url" && <UrlImportTab onDone={onClose} />}
      </div>
    </Modal>
  );
}
