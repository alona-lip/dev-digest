"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import type { RunSummary, PrCommit, FindingRecord } from "@devdigest/shared";
import { RunTile } from "./_components/RunTile";
import { timelineItems } from "./helpers";
import { s } from "./styles";

/**
 * PR timeline — every agent run interleaved with the PR's commits, newest-first
 * and DB-backed so it survives reload. Showing commits between runs makes it
 * clear which commit each review ran against. Failed runs show their error
 * inline; the logs icon on a run opens its trace. Outcome badges: see
 * `outcomeOf` in ./helpers.
 */
export function RunHistory({
  runs,
  commits = [],
  findingsByRun,
  onOpenTrace,
  onGoToReview,
  onDelete,
}: {
  runs: RunSummary[];
  commits?: PrCommit[];
  /** Per-run findings, keyed by `run_id` — drives both the read-only severity
   *  icons AND the hover popover on each tile (`RunSummary` itself has no
   *  severity breakdown). The icons/popover are never clickable — the only
   *  clickable severity control on this page is under a review-run's own
   *  SeverityFilterButtons row, further down in Review runs. */
  findingsByRun?: Map<string, FindingRecord[]>;
  /** Open the trace + log drawer for a run (the logs icon). */
  onOpenTrace: (runId: string) => void;
  /** Jump to this run's inline review accordion below (clicking the agent name). */
  onGoToReview?: (runId: string) => void;
  onDelete?: (runId: string) => void;
}) {
  if (runs.length === 0 && commits.length === 0) return null;

  return (
    <div style={s.list}>
      {timelineItems(runs, commits).map((item) => {
        if (item.kind === "commit") {
          const c = item.commit;
          return (
            <div key={`commit:${c.sha}`} style={s.commitRow}>
              <Icon.GitCommit size={15} style={s.commitIcon} />
              <span className="mono" style={s.commitSha}>
                {c.sha.slice(0, 7)}
              </span>
              <span style={s.commitMessage} title={c.message}>
                {c.message.split("\n")[0]}
              </span>
              <span style={s.commitMeta}>{c.author}</span>
              {c.committed_at && (
                <span style={s.commitMeta}>{new Date(c.committed_at).toLocaleTimeString()}</span>
              )}
            </div>
          );
        }

        return (
          <RunTile
            key={`run:${item.run.run_id}`}
            run={item.run}
            findings={findingsByRun?.get(item.run.run_id) ?? []}
            onOpenTrace={onOpenTrace}
            onGoToReview={onGoToReview}
            onDelete={onDelete}
          />
        );
      })}
    </div>
  );
}
