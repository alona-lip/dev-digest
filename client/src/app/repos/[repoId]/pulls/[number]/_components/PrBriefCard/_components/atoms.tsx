/* Logic-free pieces of PrBriefCard: the Generate/Refresh actions, the Outdated badge,
   the "Generated without" note and the centred empty state. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { BriefMissingInput } from "@devdigest/shared";
import { Badge, Button } from "@devdigest/ui";
import { capitalize } from "../helpers";
import { s } from "../styles";

export function BriefActions({
  stale,
  busy,
  intentPending,
  onRefresh,
}: {
  stale: boolean;
  busy: boolean;
  intentPending: boolean;
  onRefresh: () => void;
}) {
  const t = useTranslations("brief");
  return (
    <div style={s.actions}>
      {stale && <Badge color="var(--warn)">{t("outdated")}</Badge>}
      {intentPending && <span style={s.hint}>{t("intentPendingHint")}</span>}
      <Button
        kind="secondary"
        size="sm"
        icon="RefreshCw"
        loading={busy}
        disabled={busy}
        aria-label={t("refreshAria")}
        onClick={onRefresh}
      >
        {t("refresh")}
      </Button>
    </div>
  );
}

export function EmptyBrief({
  busy,
  intentPending,
  onGenerate,
}: {
  busy: boolean;
  intentPending: boolean;
  onGenerate: () => void;
}) {
  const t = useTranslations("brief");
  return (
    <div style={s.empty} data-testid="brief-empty-state">
      <p style={s.emptyTitle}>{t("emptyTitle")}</p>
      <p style={s.emptyHint}>{t("emptyHint")}</p>
      <Button kind="primary" icon="Sparkles" loading={busy} disabled={busy} onClick={onGenerate}>
        {t("generate")}
      </Button>
      {intentPending && <span style={s.hint}>{t("intentPendingHint")}</span>}
    </div>
  );
}

export function MissingNote({ items }: { items: BriefMissingInput[] }) {
  const t = useTranslations("brief");
  if (items.length === 0) return null;
  const label = (key: string, group: "input" | "reason") =>
    t.has(`missing.${group}.${key}`) ? t(`missing.${group}.${key}`) : key;
  const text = items
    .map((m) => `${capitalize(label(m.input, "input"))} — ${label(m.reason, "reason")}`)
    .join("; ");
  return (
    <p style={s.note}>
      {t("missing.prefix")} {text}
    </p>
  );
}
