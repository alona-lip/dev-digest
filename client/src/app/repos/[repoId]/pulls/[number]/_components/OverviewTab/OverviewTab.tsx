"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import { PrBriefCard } from "../PrBriefCard";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  repoId: string;
  repoFullName: string | null;
  headSha: string;
  prBody: string | null | undefined;
}

/** PR Brief across the top, Intent | Blast radius side by side (one column when narrow), then the description. */
export function OverviewTab({ prId, repoId, repoFullName, headSha, prBody }: OverviewTabProps) {
  const t = useTranslations("prReview");
  return (
    <>
      {prId && (
        <>
          <PrBriefCard prId={prId} />
          <div style={s.grid}>
            <IntentCard prId={prId} />
            <BlastRadiusCard prId={prId} repoId={repoId} repoFullName={repoFullName} headSha={headSha} />
          </div>
        </>
      )}
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("detail.description")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
