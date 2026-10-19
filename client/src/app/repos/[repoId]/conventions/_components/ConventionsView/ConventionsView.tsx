/* ConventionsView — body of /repos/:repoId/conventions. Run Scan (first scan, empty
   state) / Re-scan (header, once there are candidates) call the extractor; each
   candidate card is accepted, rejected or edited in place; "Create skill" (shown once
   at least one is accepted) opens the modal that merges the accepted ones into a skill. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import {
  useBulkConventionStatus,
  useConventions,
  useExtractConventions,
  useUpdateConvention,
} from "@/lib/hooks/conventions";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ConventionCard } from "../ConventionCard";
import { CreateSkillFromConventionsModal } from "../CreateSkillFromConventionsModal";
import { acceptedIds } from "./helpers";
import { s } from "./styles";

export function ConventionsView({ repoId }: { repoId: string }) {
  const t = useTranslations("conventions");
  const { repos } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: candidates, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const update = useUpdateConvention(repoId);
  const bulk = useBulkConventionStatus(repoId);
  const [creating, setCreating] = React.useState(false);

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const repoName = repos.find((r) => r.id === repoId)?.name ?? t("page.repoFallback");
  const list = candidates ?? [];
  const accepted = acceptedIds(list);
  const scan = () => extract.mutate();
  const stats = extract.data?.stats;

  const subtitle = extract.isPending
    ? t("page.scanning")
    : stats
      ? t("page.scanSummary", {
          files: stats.sampled_files,
          proposed: stats.proposed,
          dropped: stats.dropped_ungrounded,
          duplicates: stats.dropped_duplicate,
        })
      : list.length > 0
        ? t("page.candidateCount", { count: list.length })
        : t("page.subtitle");

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <div>
            <h1 style={s.title}>
              {t("page.headingPrefix")}
              <span className="mono" style={s.titleRepo}>
                {repoName}
              </span>
            </h1>
            <p style={s.subtitle}>{subtitle}</p>
          </div>
          {list.length > 0 && (
            <div style={s.headerActions}>
              <Button kind="secondary" icon="RefreshCw" onClick={scan} loading={extract.isPending}>
                {t("page.rescan")}
              </Button>
            </div>
          )}
        </div>

        {isLoading ? (
          <div style={s.list} aria-busy="true">
            <Skeleton height={190} />
            <Skeleton height={190} />
          </div>
        ) : isError ? (
          <ErrorState title={t("page.loadError")} onRetry={() => void refetch()} />
        ) : list.length === 0 ? (
          <div style={s.emptyCard}>
            <EmptyState
              icon="ListChecks"
              title={t("page.empty.title")}
              body={t("page.empty.body")}
              cta={t("page.runScan")}
              onCta={scan}
              ctaLoading={extract.isPending}
            />
          </div>
        ) : (
          <>
            <div style={s.toolbar}>
              <Button
                kind="secondary"
                size="sm"
                icon="X"
                onClick={() => bulk.mutate({ ids: accepted, status: "REJECTED" })}
                disabled={accepted.length === 0 || bulk.isPending}
              >
                {t("page.deselectAll")}
              </Button>
              <span style={s.count}>{t("page.acceptedCount", { accepted: accepted.length, total: list.length })}</span>
              {accepted.length > 0 && (
                <div style={s.toolbarRight}>
                  <Button kind="primary" icon="Sparkles" onClick={() => setCreating(true)}>
                    {t("page.createSkill")}
                  </Button>
                </div>
              )}
            </div>
            <div style={s.list}>
              {list.map((c) => (
                <ConventionCard
                  key={c.id}
                  candidate={c}
                  onStatus={(status) => update.mutate({ id: c.id, patch: { status } })}
                  onSave={(edit) => update.mutate({ id: c.id, patch: edit })}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {creating && (
        <CreateSkillFromConventionsModal repoId={repoId} repoName={repoName} onClose={() => setCreating(false)} />
      )}
    </AppShell>
  );
}
