"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";

/** Placeholder: skill evals arrive with the Evals lesson. */
export function EvalsTab() {
  const t = useTranslations("skills");
  return <EmptyState icon="FlaskConical" title={t("evals.title")} body={t("evals.comingSoon")} />;
}
