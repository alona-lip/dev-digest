"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, CircularScore } from "@devdigest/ui";
import type { RunSummary, FindingRecord } from "@devdigest/shared";
import { RunCostBadge } from "@/components/run-cost-badge";
import {
  SeverityPills,
  FindingsPopover,
  useFindingsPopoverAnchor,
  countBySeverity,
} from "@/components/severity";
import { outcomeOf } from "../../helpers";
import { s } from "./styles";

/** One Timeline run tile — its own component (not inlined in the parent's
 *  `.map()`) because it needs its own `useFindingsPopoverAnchor()` hook
 *  instance per tile; hooks can't be called a variable number of times inside
 *  a loop. */
export function RunTile({
  run: r,
  findings,
  onOpenTrace,
  onGoToReview,
  onDelete,
}: {
  run: RunSummary;
  findings: FindingRecord[];
  onOpenTrace: (runId: string) => void;
  onGoToReview?: (runId: string) => void;
  onDelete?: (runId: string) => void;
}) {
  const t = useTranslations("prReview");
  const o = outcomeOf(r);
  const settled = r.status === "done";
  const counts = React.useMemo(() => countBySeverity(findings), [findings]);
  const popover = useFindingsPopoverAnchor<HTMLDivElement>();

  return (
    <div style={s.row}>
      <Badge color={o.color} bg={o.bg} icon={o.icon}>
        {t(`runStatus.${o.key}`)}
      </Badge>
      {settled && r.score != null && <CircularScore score={r.score} size={30} stroke={3} />}
      <div style={s.body}>
        <div style={s.title}>
          <button
            type="button"
            onClick={() => onGoToReview?.(r.run_id)}
            title={t("timeline.goToReview")}
            style={s.agentLink(!!onGoToReview)}
          >
            {r.agent_name ?? t("detail.accordion.agentFallback")}
          </button>{" "}
          <span className="mono" style={s.model}>
            {r.provider}/{r.model}
          </span>
        </div>
        {r.status === "failed" && r.error && (
          <div style={s.error} title={r.error}>
            {r.error}
          </div>
        )}
        {settled && (
          <div ref={popover.ref} style={s.findingsAnchor} {...popover.handlers}>
            <span style={s.findingsText}>
              {t("runStatus.findings", { count: r.findings_count ?? 0 })}
              {(r.blockers ?? 0) > 0 ? t("runStatus.blockers", { count: r.blockers ?? 0 }) : ""}
            </span>
            <SeverityPills compact counts={counts} />
            {popover.isOpen && findings.length > 0 && (
              <FindingsPopover
                findings={findings}
                total={findings.length}
                anchorRect={popover.anchorRect}
                popoverRef={popover.popoverRef}
                {...popover.popoverHandlers}
              />
            )}
          </div>
        )}
      </div>
      <div style={s.meta}>
        {r.ran_at && <span>{new Date(r.ran_at).toLocaleTimeString()}</span>}
        {settled && (
          <RunCostBadge variant="timeline" costUsd={r.cost_usd} tokensIn={r.tokens_in} tokensOut={r.tokens_out} />
        )}
      </div>
      <button
        type="button"
        title={t("timeline.openTrace")}
        aria-label={t("timeline.openTrace")}
        onClick={() => onOpenTrace(r.run_id)}
        style={s.iconBtn}
      >
        <Icon.FileText size={13} />
      </button>
      {onDelete && r.status !== "running" && (
        <button
          type="button"
          aria-label={t("timeline.deleteRun")}
          title={t("timeline.deleteRun")}
          onClick={() => onDelete(r.run_id)}
          style={s.deleteBtn}
        >
          <Icon.Trash size={13} />
        </button>
      )}
    </div>
  );
}
