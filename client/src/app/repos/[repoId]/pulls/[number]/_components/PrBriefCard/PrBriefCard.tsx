/* PrBriefCard — the top of the Overview tab: the latest review's verdict, findings,
   summary and score (VerdictBanner) plus what that run cost. Reads the same review
   and run queries PrDetailView uses, so the cache is shared: no extra request, no
   model call. A failed reviews request is an error with Retry, never "not available". */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, SectionLabel, Skeleton } from "@devdigest/ui";
import { RunCostBadge } from "@/components/run-cost-badge";
import { usePrReviews, usePrRuns } from "@/lib/hooks/reviews";
import { VerdictBanner } from "../VerdictBanner";
import { pickLatestBrief } from "./helpers";
import { s } from "./styles";

export interface PrBriefCardProps {
  prId: string;
}

export function PrBriefCard({ prId }: PrBriefCardProps) {
  const t = useTranslations("brief");
  const { data: reviews, isLoading, error, refetch } = usePrReviews(prId);
  const { data: runs } = usePrRuns(prId);
  const brief = pickLatestBrief(reviews, runs);

  return (
    <section aria-busy={isLoading}>
      <SectionLabel icon="FileText">{t("title")}</SectionLabel>
      {isLoading ? (
        <Skeleton height={88} />
      ) : error ? (
        <ErrorState title={t("error")} body={error.message} onRetry={() => void refetch()} />
      ) : brief ? (
        <>
          <VerdictBanner
            verdict={brief.verdict}
            summary={brief.review.summary}
            score={brief.review.score}
            findingsCount={brief.review.findings.length}
            blockers={brief.blockers}
            agentName={brief.review.agent_name}
          />
          {brief.run && (
            <div style={s.meta}>
              <RunCostBadge
                costUsd={brief.run.cost_usd}
                tokensIn={brief.run.tokens_in}
                tokensOut={brief.run.tokens_out}
                variant="timeline"
              />
            </div>
          )}
        </>
      ) : (
        <div style={s.empty}>
          <p style={s.emptyTitle}>{t("unavailable")}</p>
          <p style={s.emptyHint}>{t("unavailableHint")}</p>
        </div>
      )}
    </section>
  );
}
