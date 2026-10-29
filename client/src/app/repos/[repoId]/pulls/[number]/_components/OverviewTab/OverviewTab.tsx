"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Skeleton } from "@devdigest/ui";
import { usePrBrief, useIsGeneratingPrBrief } from "@/lib/hooks/brief";
import { PrBriefCard } from "../PrBriefCard";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { RiskAreas } from "../RiskAreas";
import { ReviewFocus } from "../ReviewFocus";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  repoId: string;
  repoFullName: string | null;
  headSha: string;
  prBody: string | null | undefined;
  /** Files shown in the Diff tab; a ref outside this list does not navigate. */
  renderedFiles?: readonly string[];
  onOpenFile?: (file: string, line: number | null) => void;
}

const noop = () => {};

/** PR Brief across the top; Intent + Risk areas | Blast radius (one column when narrow); Review focus full width; then the description. */
export function OverviewTab({
  prId,
  repoId,
  repoFullName,
  headSha,
  prBody,
  renderedFiles = [],
  onOpenFile = noop,
}: OverviewTabProps) {
  const t = useTranslations("prReview");
  const tb = useTranslations("brief");
  const { data: briefResponse } = usePrBrief(prId);
  const generating = useIsGeneratingPrBrief(prId);
  const brief = briefResponse?.status === "ready" ? briefResponse.brief : null;
  return (
    <>
      {prId && (
        <>
          <PrBriefCard prId={prId} />
          <div style={s.grid}>
            <div style={s.column}>
              <IntentCard prId={prId} />
              {generating ? (
                <ListSkeleton label={tb("riskAreas")} />
              ) : (
                brief && <RiskAreas risks={brief.risks} renderedFiles={renderedFiles} onOpenFile={onOpenFile} />
              )}
            </div>
            <BlastRadiusCard prId={prId} repoId={repoId} repoFullName={repoFullName} headSha={headSha} />
          </div>
          {generating ? (
            <ListSkeleton label={tb("reviewFocus.title")} />
          ) : (
            brief && <ReviewFocus items={brief.review_focus} renderedFiles={renderedFiles} onOpenFile={onOpenFile} />
          )}
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

function ListSkeleton({ label }: { label: string }) {
  return (
    <section aria-busy="true" data-testid="brief-list-skeleton">
      <SectionLabel>{label}</SectionLabel>
      <Skeleton height={44} />
    </section>
  );
}
