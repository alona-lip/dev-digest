/* IntentCard — the PR's derived purpose and scope (Intent Layer) on the Overview
   tab: the intent as a quote, IN SCOPE (✓) and OUT OF SCOPE (✗) lists, and a
   Recompute button. The first GET derives + stores the intent server-side, so
   the first open shows a skeleton for the length of one cheap model call. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import { useIntent, useRecomputeIntent } from "@/lib/hooks/intent";
import { s } from "./styles";

export interface IntentCardProps {
  prId: string;
}

export function IntentCard({ prId }: IntentCardProps) {
  const t = useTranslations("prReview.intent");
  const { data, isLoading, error } = useIntent(prId);
  const recompute = useRecomputeIntent(prId);
  const failure = recompute.error ?? error;

  return (
    <section aria-busy={isLoading || recompute.isPending}>
      <SectionLabel
        icon="Target"
        right={
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            loading={recompute.isPending}
            disabled={isLoading}
            onClick={() => recompute.mutate()}
          >
            {t("recompute")}
          </Button>
        }
      >
        {t("title")}
      </SectionLabel>

      <div style={s.card}>
        {failure && (
          <p role="alert" style={s.error}>
            {t("error", { message: failure.message })}
          </p>
        )}
        {isLoading ? (
          <>
            <Skeleton height={18} />
            <Skeleton height={64} />
          </>
        ) : data ? (
          <>
            <blockquote style={s.quote}>{data.intent}</blockquote>
            <div style={s.columns}>
              <ScopeList title={t("inScope")} items={data.in_scope} kind="in" noneLabel={t("none")} />
              <ScopeList title={t("outOfScope")} items={data.out_of_scope} kind="out" noneLabel={t("none")} />
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function ScopeList({
  title,
  items,
  kind,
  noneLabel,
}: {
  title: string;
  items: string[];
  kind: "in" | "out";
  noneLabel: string;
}) {
  const ItemIcon = kind === "in" ? Icon.Check : Icon.X;
  return (
    <div>
      <h4 style={s.listTitle}>{title}</h4>
      {items.length === 0 ? (
        <p style={s.none}>{noneLabel}</p>
      ) : (
        <ul style={s.list} aria-label={title}>
          {items.map((item, i) => (
            <li key={`${i}-${item}`} style={s.item}>
              <ItemIcon size={14} aria-hidden style={kind === "in" ? s.inScopeIcon : s.outOfScopeIcon} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
