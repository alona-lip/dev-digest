/* RiskAreas — the risks of the generated PR brief, under the Intent lists. Rows are
   sorted high → medium → low, start collapsed, and show the first file ref in full.
   Model text is rendered as plain text only; a ref is a button, never a built link. */
"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon, SectionLabel } from "@devdigest/ui";
import type { Risk } from "@devdigest/shared";
import { KIND_ICON, SEVERITY_COLOR } from "./constants";
import { parseFileRef, sortBySeverity } from "./helpers";
import { s } from "./styles";

export interface RiskAreasProps {
  risks: readonly Risk[];
  renderedFiles?: readonly string[];
  onOpenFile?: (file: string, line: number | null) => void;
}

export function RiskAreas({ risks, renderedFiles = [], onOpenFile = () => {} }: RiskAreasProps) {
  const t = useTranslations("brief");
  const sorted = sortBySeverity(risks);
  return (
    <section style={s.section}>
      <SectionLabel icon="AlertTriangle">{t("riskAreas")}</SectionLabel>
      {sorted.length === 0 ? (
        <p style={s.empty}>{t("noRisks")}</p>
      ) : (
        <ul style={s.list}>
          {sorted.map((risk, i) => (
            <RiskRow key={`${i}-${risk.title}`} risk={risk} renderedFiles={renderedFiles} onOpenFile={onOpenFile} />
          ))}
        </ul>
      )}
    </section>
  );
}

interface RiskRowProps {
  risk: Risk;
  renderedFiles: readonly string[];
  onOpenFile: (file: string, line: number | null) => void;
}

function RiskRow({ risk, renderedFiles, onOpenFile }: RiskRowProps) {
  const t = useTranslations("brief");
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);
  const KindIcon = Icon[KIND_ICON[risk.kind]];
  const severity = t(`severity.${risk.severity}`);
  const [first, ...rest] = risk.file_refs;

  const openRef = (ref: string) => {
    const { path, line } = parseFileRef(ref);
    if (renderedFiles.includes(path)) {
      setMissing(null);
      onOpenFile(path, line);
    } else {
      setMissing(ref);
    }
  };

  const refButton = (ref: string) => (
    <button key={ref} type="button" style={s.ref} onClick={() => openRef(ref)}>
      {ref}
    </button>
  );

  return (
    <li aria-label={t("riskRowAria", { severity, title: risk.title })} style={s.row}>
      <div style={s.head}>
        <span
          role="img"
          aria-label={t(`riskKind.${risk.kind}`)}
          data-kind={risk.kind}
          data-severity={risk.severity}
          style={{ ...s.icon, color: SEVERITY_COLOR[risk.severity] }}
        >
          <KindIcon size={16} aria-hidden="true" />
        </span>
        <div style={s.titleBlock}>
          <span style={s.title}>{risk.title}</span>
          {first !== undefined && refButton(first)}
        </div>
        <button
          type="button"
          style={s.chevron}
          aria-expanded={open}
          aria-label={open ? t("collapseRisk") : t("expandRisk")}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <Icon.ChevronDown size={16} aria-hidden="true" /> : <Icon.ChevronRight size={16} aria-hidden="true" />}
        </button>
      </div>
      {missing !== null && (
        <span role="status" style={s.notice}>
          {t("fileNotInDiff")}
        </span>
      )}
      {open && (
        <>
          <p style={s.explanation}>{risk.explanation}</p>
          {rest.length > 0 && <div style={s.refs}>{rest.map(refButton)}</div>}
        </>
      )}
    </li>
  );
}
