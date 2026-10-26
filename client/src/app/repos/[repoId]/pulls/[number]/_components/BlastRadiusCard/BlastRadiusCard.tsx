/* BlastRadiusCard — what else in the repo a PR reaches: changed symbols, their callers,
   and the HTTP endpoints / cron jobs behind those callers. Read from the prebuilt
   repo-intel index (no LLM). A degraded index is flagged honestly, with a Resync. */
"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, SectionLabel, Skeleton } from "@devdigest/ui";
import type { PrBlastRadius } from "@devdigest/shared";
import { useBlastRadius, useBlastResync } from "@/lib/hooks/blast";
import { BlastTree } from "./_components/BlastTree";
import { BlastGraph } from "./_components/BlastGraph";
import { PriorPrs } from "./_components/PriorPrs";
import { BLAST_VIEW, NO_RESYNC_REASON, REASON_KEY, STAT_KEYS, type BlastView } from "./constants";
import { summarize, type BlastCounts } from "./helpers";
import { s } from "./styles";

export interface BlastRadiusCardProps {
  prId: string;
  repoId: string;
  repoFullName: string | null;
  headSha: string;
}

export function BlastRadiusCard({ prId, repoId, repoFullName, headSha }: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const [view, setView] = useState<BlastView>(BLAST_VIEW.TREE);
  const { data, isLoading, error, refetch } = useBlastRadius(prId);
  const canResync = !!data?.degraded && data.reason !== NO_RESYNC_REASON;
  const { resync, resyncing, resyncError } = useBlastResync(repoId, prId, canResync);

  return (
    <section aria-busy={isLoading} style={s.section}>
      <SectionLabel
        icon="Zap"
        right={
          <div role="group" aria-label={t("view.label")} style={s.toggle}>
            <ViewButton active={view === BLAST_VIEW.TREE} onClick={() => setView(BLAST_VIEW.TREE)}>
              {t("view.tree")}
            </ViewButton>
            <ViewButton active={view === BLAST_VIEW.GRAPH} onClick={() => setView(BLAST_VIEW.GRAPH)}>
              {t("view.graph")}
            </ViewButton>
          </div>
        }
      >
        {t("title")}
      </SectionLabel>

      <div style={s.card}>
        <BlastBody
          data={data}
          isLoading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          view={view}
          canResync={canResync}
          resync={resync}
          resyncing={resyncing}
          resyncError={resyncError}
          repoFullName={repoFullName}
          headSha={headSha}
        />
        <PriorPrs prId={prId} repoFullName={repoFullName} />
      </div>
    </section>
  );
}

interface BlastBodyProps {
  data: PrBlastRadius | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  view: BlastView;
  canResync: boolean;
  resync: () => void;
  resyncing: boolean;
  resyncError: Error | null;
  repoFullName: string | null;
  headSha: string;
}

function BlastBody({ data, isLoading, error, onRetry, view, canResync, resync, resyncing, resyncError, repoFullName, headSha }: BlastBodyProps) {
  const t = useTranslations("blast");
  if (isLoading) {
    return (
      <>
        <Skeleton height={36} />
        <Skeleton height={64} />
      </>
    );
  }
  if (error) return <ErrorState title={t("error")} body={error.message} onRetry={onRetry} />;
  if (!data) return null;

  return (
    <>
      <SummaryRow counts={summarize(data)} />

      {data.degraded && data.reason && (
        <div style={s.degraded}>
          <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)">
            {t("degraded.label", { reason: t(REASON_KEY[data.reason]) })}
          </Badge>
          {canResync && (
            <Button kind="secondary" size="sm" icon="RefreshCw" loading={resyncing} onClick={resync}>
              {resyncing ? t("resyncing") : t("resync")}
            </Button>
          )}
          {resyncError && (
            <span role="alert" style={s.resyncError}>
              {t("resyncError", { message: resyncError.message })}
            </span>
          )}
        </div>
      )}

      {/* BlastGraph owns its own empty state. */}
      {view === BLAST_VIEW.GRAPH ? (
        <BlastGraph blast={data} />
      ) : data.downstream.length === 0 ? (
        <p style={s.none}>{t("noDownstream", { count: data.changed_symbols.length })}</p>
      ) : (
        <BlastTree groups={data.downstream} repoFullName={repoFullName} headSha={headSha} />
      )}
    </>
  );
}

function ViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    // `Button` only renders `active` for kind="tertiary", so the selected state is styled here.
    <Button
      kind="secondary"
      size="sm"
      active={active}
      aria-pressed={active}
      style={active ? s.viewActive : undefined}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function SummaryRow({ counts }: { counts: BlastCounts }) {
  const t = useTranslations("blast");
  return (
    <dl style={s.summary}>
      {STAT_KEYS.map((key) => (
        <div key={key} style={s.stat}>
          <dt style={s.statLabel}>{t(`stat.${key}`)}</dt>
          <dd style={s.statValue}>{counts[key]}</dd>
        </div>
      ))}
    </dl>
  );
}
