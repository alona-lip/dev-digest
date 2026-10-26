/* PriorPrs — merged PRs that touched the same files as this PR, as an accordion pinned to the
   bottom of the card (collapsed by default; the count shows while collapsed). Loads on its own
   and fails quietly: an error here is one muted line and never hides the blast map. */
"use client";

import { useId, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Icon, Skeleton } from "@devdigest/ui";
import type { PrHistoryItem } from "@devdigest/shared";
import { usePriorPrs } from "@/lib/hooks/blast";
import { githubPrUrl } from "@/lib/github-urls";
import { s } from "./styles";

export interface PriorPrsProps {
  prId: string;
  repoFullName: string | null;
}

export function PriorPrs({ prId, repoFullName }: PriorPrsProps) {
  const t = useTranslations("blast.prior");
  const { data, isLoading, error } = usePriorPrs(prId);
  const history = data?.history ?? [];
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return (
    <div style={s.block} aria-busy={isLoading}>
      <button
        type="button"
        style={s.header}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon.History size={14} aria-hidden />
        <span style={s.title}>{t("title")}</span>
        {history.length > 0 && <span style={s.count}>{history.length}</span>}
        <Icon.ChevronDown size={14} aria-hidden style={open ? s.chevronOpen : s.chevron} />
      </button>
      {/* Always mounted so `aria-controls` points at a real element; hidden while collapsed. */}
      <div id={bodyId} hidden={!open}>
        {open &&
          (isLoading ? (
            <Skeleton height={36} />
          ) : error ? (
            <p style={s.note}>{t("error", { message: error.message })}</p>
          ) : history.length === 0 ? (
            <p style={s.note}>{t("empty")}</p>
          ) : (
            <PriorList items={history} repoFullName={repoFullName} />
          ))}
      </div>
    </div>
  );
}

function PriorList({ items, repoFullName }: { items: PrHistoryItem[]; repoFullName: string | null }) {
  const t = useTranslations("blast.prior");
  const format = useFormatter();
  const [now] = useState(() => new Date());

  return (
    <ul style={s.list}>
      {items.map((pr) => {
        const label = (
          <>
            <span style={s.num}>#{pr.pr_number}</span>
            {pr.title}
          </>
        );
        return (
          <li key={pr.pr_number} style={s.row}>
            <span style={s.pr}>
              {repoFullName ? (
                <a
                  href={githubPrUrl(repoFullName, pr.pr_number)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={s.link}
                >
                  {label}
                </a>
              ) : (
                label
              )}
            </span>
            <span style={s.overlap} title={pr.files_overlap.join("\n")}>
              {t("overlap", { count: pr.files_overlap.length })}
            </span>
            <span style={s.date}>{format.relativeTime(new Date(pr.merged_at), now)}</span>
          </li>
        );
      })}
    </ul>
  );
}
