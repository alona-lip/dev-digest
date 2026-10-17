"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { TYPE_COLORS } from "./constants";

/** The coloured `rubric` / `convention` / `security` / `custom` chip. */
export function SkillTypeBadge({ type }: { type: SkillType }) {
  const t = useTranslations("skills");
  const c = TYPE_COLORS[type];
  return (
    <Badge color={c.color} bg={c.bg}>
      {t(`listItem.type.${type}`)}
    </Badge>
  );
}
