/* SkillScanBanner — the red "INJECTION DETECTED — DO NOT ENABLE" banner for a
   skill whose body failed the prompt-injection scan, with every finding (line,
   what it does, the offending text, pattern or LLM). Renders nothing for a clean
   scan. Shared by the skill editor and the import preview. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { SkillScan } from "@devdigest/shared";
import { s } from "./styles";

export function SkillScanBanner({
  scan,
  body,
  style,
}: {
  scan: SkillScan;
  /** Overrides the default text (the import preview explains that it will be saved blocked). */
  body?: string;
  style?: React.CSSProperties;
}) {
  const t = useTranslations("skills");
  if (scan.status !== "injection") return null;
  return (
    <div role="alert" style={{ ...s.banner, ...style }}>
      <div style={s.head}>
        <Icon.AlertOctagon size={16} style={s.icon} />
        <strong style={s.title}>{t("scan.title")}</strong>
        <span style={s.text}>{body ?? t("scan.body")}</span>
      </div>
      {scan.findings.length > 0 && (
        <ul style={s.list}>
          {scan.findings.map((f, i) => (
            <li key={`${f.rule}:${f.line}:${i}`} style={s.item}>
              <span style={s.where}>{f.line != null ? t("scan.line", { line: f.line }) : "—"}</span>
              <span style={s.label}>{f.label}</span>
              <Badge color="var(--crit)" bg="transparent" style={s.source}>
                {t(`scan.source.${f.source}`)}
              </Badge>
              <code className="mono" style={s.excerpt}>
                {f.excerpt}
              </code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
