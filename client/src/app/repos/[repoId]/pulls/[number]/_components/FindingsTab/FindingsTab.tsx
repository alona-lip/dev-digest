"use client";

import React, { useCallback } from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Button, SectionLabel, EmptyState } from "@devdigest/ui";
import { RunStatus } from "../RunStatus";
import { RunHistory } from "../RunHistory";
import { ReviewRunAccordion } from "../ReviewRunAccordion";
import { useCancelRun } from "@/lib/hooks/reviews";
import { s } from "./styles";
import type { FindingRecord, ReviewRecord, RunSummary, PrCommit, Severity } from "@devdigest/shared";

interface FindingsTabProps {
  prId: string | null;
  liveRunIds: string[];
  reviewRunning: boolean;
  lethalTrifecta: FindingRecord[];
  runs: ReviewRecord[];
  prRuns: RunSummary[] | undefined;
  prCommits: PrCommit[];
  /** owner/repo + head sha — used to deep-link a finding's file:line to GitHub. */
  repoFullName?: string | null;
  headSha?: string | null;
  /** Active severity filter (one `?severity=` for the whole PR-detail page). */
  severity?: Severity | null;
  onSeverityChange?: (severity: Severity | null) => void;
  onOpenTrace: (id: string) => void;
  onDelete: (id: string) => void;
  onRunDone: () => void;
}

export function FindingsTab({
  prId,
  liveRunIds,
  reviewRunning,
  lethalTrifecta,
  runs,
  prRuns,
  prCommits,
  repoFullName,
  headSha,
  severity,
  onSeverityChange,
  onOpenTrace,
  onDelete,
  onRunDone,
}: FindingsTabProps) {
  const t = useTranslations("prReview");
  const cancelMutation = useCancelRun(prId);
  const handleCancelAll = useCallback(() => {
    liveRunIds.forEach((id) => cancelMutation.mutate(id));
  }, [liveRunIds, cancelMutation]);

  const handleOpenFirstTrace = useCallback(() => {
    if (liveRunIds[0]) onOpenTrace(liveRunIds[0]);
  }, [liveRunIds, onOpenTrace]);

  const handleOpenTrace = useCallback(
    (id: string) => {
      onOpenTrace(id);
    },
    [onOpenTrace],
  );

  const handleDelete = useCallback(
    (id: string) => {
      onDelete(id);
    },
    [onDelete],
  );

  // Timeline → Review-runs navigation: clicking an agent name in the timeline
  // opens + scrolls to that run's accordion below. The nonce re-triggers the
  // scroll even when the same run is clicked twice.
  const [target, setTarget] = React.useState<{ runId: string; n: number } | null>(null);
  const handleGoToReview = useCallback((runId: string) => {
    setTarget((p) => ({ runId, n: (p?.n ?? 0) + 1 }));
  }, []);

  // Per-run findings for the Timeline tiles — drives both the read-only
  // severity icons and their hover popover (never a click; see RunHistory).
  // `RunSummary` (from `/pulls/:id/runs`) has no findings of its own, but
  // each `ReviewRecord` here already carries its findings and `run_id` —
  // no extra request.
  const findingsByRun = React.useMemo(() => {
    const m = new Map<string, FindingRecord[]>();
    for (const r of runs) {
      if (r.run_id) m.set(r.run_id, r.findings);
    }
    return m;
  }, [runs]);

  return (
    <section>
      {liveRunIds.length > 0 && (
        <div style={s.liveRunSection}>
          <SectionLabel
            icon="Sparkles"
            right={
              <div style={s.cancelActions}>
                <Button
                  kind="danger"
                  size="sm"
                  icon="X"
                  loading={cancelMutation.isPending}
                  onClick={handleCancelAll}
                >
                  {t("detail.runs.cancel")}
                </Button>
                <Button kind="ghost" size="sm" icon="FileText" onClick={handleOpenFirstTrace}>
                  {t("detail.runs.openTrace")}
                </Button>
              </div>
            }
          >
            {t("detail.runs.liveReview")}
          </SectionLabel>
          <RunStatus runIds={liveRunIds} onDone={onRunDone} />
        </div>
      )}

      {reviewRunning && (
        <div style={s.reviewInProgress}>
          <Icon.RefreshCw size={16} style={{ color: "var(--accent)", animation: "ddspin 1s linear infinite" }} />
          <span style={s.reviewInProgressText}>{t("detail.runs.inProgress")}</span>
          <span style={s.reviewInProgressSub}>{t("detail.runs.inProgressHint")}</span>
        </div>
      )}

      {lethalTrifecta.length > 0 && (
        <div style={s.lethalTrifecta}>
          <Icon.Shield size={16} style={{ color: "var(--crit)" }} />
          <span style={s.lethalTrifectaTitle}>{t("detail.runs.trifectaDetected")}</span>
          <Badge color="var(--crit)" bg="transparent">
            {t("detail.runs.trifectaCount", { count: lethalTrifecta.length })}
          </Badge>
        </div>
      )}

      {((prRuns && prRuns.length > 0) || prCommits.length > 0) && (
        <div style={s.timelineSection}>
          <SectionLabel
            icon="Activity"
            right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("detail.runs.timelineHint")}</span>}
          >
            {t("detail.runs.timeline")}
          </SectionLabel>
          <RunHistory
            runs={prRuns ?? []}
            commits={prCommits}
            findingsByRun={findingsByRun}
            onOpenTrace={handleOpenTrace}
            onGoToReview={handleGoToReview}
            onDelete={handleDelete}
          />
        </div>
      )}

      <SectionLabel
        icon="AlertOctagon"
        right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("detail.runs.reviewRunsHint")}</span>}
      >
        {t("detail.runs.reviewRuns")}
      </SectionLabel>
      {runs.length === 0 ? (
        reviewRunning || liveRunIds.length > 0 ? null : (
          <EmptyState
            icon="Sparkles"
            title={t("detail.runs.emptyTitle")}
            body={t("detail.runs.emptyBody")}
          />
        )
      ) : (
        prId &&
        runs.map((review, i) => (
          <ReviewRunAccordion
            key={review.id}
            review={review}
            prId={prId}
            defaultOpen={i === 0}
            repoFullName={repoFullName}
            headSha={headSha}
            targetRunId={target?.runId ?? null}
            targetNonce={target?.n ?? 0}
            severity={severity}
            onSeverityChange={onSeverityChange}
          />
        ))
      )}
    </section>
  );
}
