/* PullsListView — body of /repos/:repoId/pulls. Ported from
   screen_dashboard.jsx; fetches GET /repos/:id/pulls (F1). Status filter and
   sort live in the URL (?status&sort); the search box is local state. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Skeleton,
  EmptyState,
  ErrorState,
  AutoTriggerStatus,
} from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { usePulls, useRefreshRepo } from "@/lib/hooks";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { COLUMN_KEYS, DEFAULT_STATUS_FILTER, SKELETON_ROWS } from "../../constants";
import { countPulls, filterPulls, parseSortParam } from "../../helpers";
import { s } from "../../styles";
import { PRRow } from "../PRRow";
import { FilterBar } from "../FilterBar";

export function PullsListView({ repoId }: { repoId: string }) {
  const t = useTranslations("prReview");
  const search = useSearchParams();
  const router = useRouter();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: pulls, isLoading, isError, error, refetch } = usePulls(repoId);
  const refresh = useRefreshRepo();

  const status = search.get("status") ?? DEFAULT_STATUS_FILTER;
  const sort = parseSortParam(search.get("sort"));
  const setParam = (key: string, value: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set(key, value); // always explicit so "all" sticks over the needs_review default
    router.replace(`/repos/${repoId}/pulls?${sp.toString()}`);
  };

  const [query, setQuery] = React.useState("");

  const filtered = filterPulls(pulls ?? [], { status, query, sort });
  const repoName = activeRepo?.full_name ?? repoId;
  const { open: openCount, needsReview: needsReviewCount } = countPulls(pulls ?? []);

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: repoName, mono: true }, { label: t("list.breadcrumb") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: repoName, mono: true }, { label: t("list.breadcrumb") }]}>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>{t("list.title")}</h1>
          <p style={s.pageSubtitle}>
            {pulls
              ? t("list.summary", { open: openCount, needsReview: needsReviewCount })
              : t("list.loading")}
          </p>
        </div>
        <div style={s.headerActions}>
          <AutoTriggerStatus on={false} />
        </div>
      </div>

      <div style={s.tableCard}>
        <FilterBar
          active={status}
          onActive={(k) => setParam("status", k)}
          query={query}
          onQuery={setQuery}
          sort={sort}
          onSort={(v) => setParam("sort", v)}
          onRefresh={() => refresh.mutate(repoId)}
          refreshing={refresh.isPending}
        />
        <div style={s.headRow}>
          {COLUMN_KEYS.map((key, i) => (
            <div key={key} style={s.headCell(i === COLUMN_KEYS.length - 1)}>
              {t(`list.columns.${key}`)}
            </div>
          ))}
        </div>

        {isLoading ? (
          <div style={s.loadingStack}>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Skeleton key={i} height={28} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title={t("list.errorTitle")}
            body={error instanceof ApiError ? error.message : t("list.errorBody")}
            onRetry={() => refetch()}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="GitPullRequest"
            title={t("list.emptyTitle")}
            body={
              status === "all"
                ? t("list.emptyAllBody")
                : t("list.emptyStatusBody", { status })
            }
          />
        ) : (
          filtered.map((pr) => <PRRow key={pr.number} pr={pr} repoId={repoId} />)
        )}
      </div>
    </AppShell>
  );
}
