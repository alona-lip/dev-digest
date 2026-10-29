/* PrBriefCard — the top of the Overview tab. Shows the generated PR brief (summary,
   Outdated badge, "Generated without" note) and the latest review's verdict banner.
   Nothing here calls a model on mount: the brief is only read (GET) until the user
   presses Generate / Refresh (POST, one model call). A failed read is an error with
   Retry and no Generate button; a failed generation is an inline alert and the
   previous brief stays on screen (the query data is not touched). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, SectionLabel, Skeleton } from "@devdigest/ui";
import { RunCostBadge } from "@/components/run-cost-badge";
import { usePrReviews, usePrRuns } from "@/lib/hooks/reviews";
import { useGeneratePrBrief, useIsGeneratingPrBrief, usePrBrief } from "@/lib/hooks/brief";
import { useIntent } from "@/lib/hooks/intent";
import { VerdictBanner } from "../VerdictBanner";
import { BriefActions, EmptyBrief, MissingNote } from "./_components/atoms";
import { pickLatestBrief, pickReady } from "./helpers";
import { s } from "./styles";

export interface PrBriefCardProps {
  prId: string;
}

export function PrBriefCard({ prId }: PrBriefCardProps) {
  const t = useTranslations("brief");
  const reviewsQ = usePrReviews(prId);
  const { data: runs } = usePrRuns(prId);
  const briefQ = usePrBrief(prId);
  const generate = useGeneratePrBrief(prId);
  const generating = useIsGeneratingPrBrief(prId) || generate.isPending;
  const intentPending = useIntent(prId).isPending;

  const latest = pickLatestBrief(reviewsQ.data, runs);
  const loading = reviewsQ.isLoading || briefQ.isLoading;
  // Blocking error only when there is nothing to show: a failed background refetch
  // keeps the previous data (TanStack Query v5) and must not replace the card.
  const error =
    (reviewsQ.data === undefined ? reviewsQ.error : null) ?? (briefQ.data === undefined ? briefQ.error : null);
  const data = briefQ.data;
  const ready = pickReady(data);

  const onGenerate = () => {
    if (!generating) generate.mutate();
  };
  const retry = () => {
    if (reviewsQ.error) void reviewsQ.refetch();
    if (briefQ.error) void briefQ.refetch();
  };
  const actions = ready && (
    <BriefActions stale={ready.stale} busy={generating} intentPending={intentPending} onRefresh={onGenerate} />
  );
  const summarySkeleton = generating ? <Skeleton height={44} /> : null;

  return (
    <section aria-busy={loading || generating}>
      <SectionLabel icon="FileText">{t("title")}</SectionLabel>
      {loading ? (
        <Skeleton height={88} />
      ) : error ? (
        <ErrorState title={t("error")} body={error.message} onRetry={retry} />
      ) : (
        <>
          {generate.error && (
            <p role="alert" style={s.error}>
              {t("generateError")}: {generate.error.message}
            </p>
          )}
          {latest && (
            <>
              <VerdictBanner
                verdict={latest.verdict}
                summary={ready ? (generating ? null : ready.brief.summary) : latest.review.summary}
                score={latest.review.score}
                findingsCount={latest.review.findings.length}
                blockers={latest.blockers}
                agentName={latest.review.agent_name}
                action={actions}
              />
              {ready && summarySkeleton}
              {latest.run && (
                <div style={s.meta}>
                  <RunCostBadge
                    costUsd={latest.run.cost_usd}
                    tokensIn={latest.run.tokens_in}
                    tokensOut={latest.run.tokens_out}
                    variant="timeline"
                  />
                </div>
              )}
            </>
          )}
          {ready && !latest && (
            <div style={s.block}>
              <div style={s.blockTop} data-testid="brief-block-actions">{actions}</div>
              {generating ? summarySkeleton : <p style={s.summary}>{ready.brief.summary}</p>}
            </div>
          )}
          {ready && !generating && <MissingNote items={ready.brief.missing_inputs} />}
          {!ready && (
            <>
              {summarySkeleton}
              <EmptyBrief busy={generating} intentPending={intentPending} onGenerate={onGenerate} />
            </>
          )}
        </>
      )}
    </section>
  );
}
