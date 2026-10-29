"use client";

/* Project Context page body — read-only view of the repo's markdown documents:
   grouped list + case-insensitive path filter, markdown preview of the selection,
   usage counters for it, summary line and a refresh that re-reads the clone. */

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { MarkdownPreview } from "@/components/markdown-preview";
import { RepoNotFound } from "@/components/repo-not-found";
import { useContextDoc, useContextDocs, useContextUsage } from "@/lib/hooks";
import { useRepoNotFound } from "@/lib/repo-context";
import { filterDocs, groupDocs, relativeTime, totalTokens } from "./helpers";
import { s } from "./styles";

export function ProjectContextView({ repoId }: { repoId: string }) {
  const t = useTranslations("context");
  const repoNotFound = useRepoNotFound(repoId);
  const list = useContextDocs(repoId);
  const usage = useContextUsage(repoId);
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(null);
  const doc = useContextDoc(repoId, selected);

  const crumb = [{ label: t("page.crumbWorkspace") }, { label: t("page.crumbContext") }];
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const data = list.data;
  const refreshing = list.isFetching || usage.isFetching;
  const refresh = () => {
    void list.refetch();
    void usage.refetch();
  };
  const counts = selected ? usage.data?.by_path[selected] : undefined;
  const visible = data ? filterDocs(data.docs, query) : [];

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <div>
            <h1 style={s.title}>{t("page.heading")}</h1>
            {selected && (
              <p style={s.usage}>
                {t("page.usedBy", { agents: counts?.agents ?? 0, skills: counts?.skills ?? 0 })}
              </p>
            )}
          </div>
          <div style={s.headerActions}>
            <Button kind="secondary" icon="RefreshCw" onClick={refresh} loading={refreshing}>
              {t("page.refresh")}
            </Button>
          </div>
        </div>

        {list.isLoading ? (
          <div aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Skeleton height={36} />
            <Skeleton height={220} />
          </div>
        ) : list.isError || !data ? (
          <ErrorState title={t("page.loadError")} onRetry={() => void list.refetch()} />
        ) : data.status === "not_cloned" ? (
          <div style={s.card}>
            <EmptyState icon="GitBranch" title={t("page.notCloned.title")} body={t("page.notCloned.body")} />
          </div>
        ) : data.docs.length === 0 ? (
          <div style={s.card}>
            <EmptyState
              icon="FileText"
              title={t("page.empty.title")}
              body={t("page.empty.body", { glob: data.glob })}
            />
          </div>
        ) : (
          <>
            <p style={s.summary}>
              {t("page.summary", {
                count: data.docs.length,
                tokens: totalTokens(data.docs),
                time: relativeTime(data.read_at),
              })}
            </p>
            {data.truncated && <p style={s.notice}>{t("page.truncated")}</p>}
            <div style={s.split}>
              <div style={s.listPane}>
                <input
                  type="search"
                  style={s.filter}
                  value={query}
                  placeholder={t("page.filterPlaceholder")}
                  aria-label={t("page.filterPlaceholder")}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {visible.length === 0 ? (
                  <span style={s.muted}>{t("page.noMatches")}</span>
                ) : (
                  groupDocs(visible).map((g) => (
                    <section key={g.type} aria-label={t(`page.type.${g.type}`)}>
                      <h2 style={s.groupTitle}>{t(`page.type.${g.type}`)}</h2>
                      {g.docs.map((d) => (
                        <button
                          key={d.path}
                          type="button"
                          className="mono"
                          aria-pressed={d.path === selected}
                          style={d.path === selected ? { ...s.row, ...s.rowActive } : s.row}
                          onClick={() => setSelected(d.path)}
                        >
                          {d.path}
                        </button>
                      ))}
                    </section>
                  ))
                )}
              </div>
              <div style={{ ...s.card, ...s.preview }}>
                {!selected ? (
                  <span style={s.muted}>{t("page.selectPrompt")}</span>
                ) : doc.isError ? (
                  <span role="alert">{t("page.previewError")}</span>
                ) : doc.isLoading ? (
                  <Skeleton height={160} />
                ) : (
                  <MarkdownPreview>{doc.data?.content}</MarkdownPreview>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
