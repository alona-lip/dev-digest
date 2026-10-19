/* ConventionCard — one candidate: the rule (editable inline), its category, the
   evidence block, the confidence bar, and Accept / Reject / Edit. ACCEPTED rules are
   the ones merged into the skill; a REJECTED card is dimmed and stays rejected. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ProgressBar, SelectInput, TextInput } from "@devdigest/ui";
import { ConventionCategory, type ConventionCandidate, type ConventionStatus } from "@devdigest/shared";
import { EvidenceBlock } from "./_components/EvidenceBlock";
import { confidenceColor, confidencePct } from "./helpers";
import { s } from "./styles";

export interface ConventionEdit {
  rule: string;
  category: ConventionCategory;
}

export function ConventionCard({
  candidate,
  onStatus,
  onSave,
}: {
  candidate: ConventionCandidate;
  onStatus: (status: ConventionStatus) => void;
  onSave: (edit: ConventionEdit) => void;
}) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [rule, setRule] = React.useState(candidate.rule);
  const [category, setCategory] = React.useState<ConventionCategory>(candidate.category);
  const [touched, setTouched] = React.useState(false);

  const accepted = candidate.status === "ACCEPTED";
  const pct = confidencePct(candidate.confidence);
  const ruleEmpty = !rule.trim();

  const startEdit = () => {
    setRule(candidate.rule);
    setCategory(candidate.category);
    setTouched(false);
    setEditing(true);
  };

  const save = () => {
    setTouched(true);
    if (ruleEmpty) return;
    onSave({ rule: rule.trim(), category });
    setEditing(false);
  };

  return (
    <article data-testid="convention-card" style={s.card(accepted)}>
      <div style={s.main}>
        {editing ? (
          <div style={s.editor}>
            <TextInput value={rule} onChange={setRule} aria-label={t("card.rule")} maxLength={500} autoFocus />
            <div style={s.editorRow}>
              <div style={s.editorCategory}>
                <SelectInput
                  value={category}
                  onChange={(v) => setCategory(v as ConventionCategory)}
                  options={ConventionCategory.options.map((c) => ({ value: c, label: t(`card.categories.${c}`) }))}
                  mono={false}
                />
              </div>
              <Button kind="primary" size="sm" icon="Check" onClick={save}>
                {t("card.save")}
              </Button>
              <Button kind="secondary" size="sm" onClick={() => setEditing(false)}>
                {t("card.cancel")}
              </Button>
            </div>
            {touched && ruleEmpty && (
              <span role="alert" style={s.editorError}>
                {t("card.ruleRequired")}
              </span>
            )}
          </div>
        ) : (
          <div style={s.titleRow}>
            <h3 style={s.rule}>{candidate.rule}</h3>
            <span style={s.category}>{t(`card.categories.${candidate.category}`)}</span>
          </div>
        )}

        <EvidenceBlock
          path={candidate.evidence_path}
          startLine={candidate.evidence_start_line}
          endLine={candidate.evidence_end_line}
          snippet={candidate.evidence_snippet}
        />

        <div style={s.confRow}>
          <span>{t("card.confidence")}</span>
          <div style={s.confBar}>
            <ProgressBar value={pct} color={confidenceColor(candidate.confidence)} />
          </div>
          <span className="mono tnum">{pct}%</span>
        </div>
      </div>

      <div style={s.actions}>
        <Button
          kind={accepted ? "primary" : "secondary"}
          icon="Check"
          full
          aria-pressed={accepted}
          onClick={() => !accepted && onStatus("ACCEPTED")}
        >
          {accepted ? t("card.accepted") : t("card.accept")}
        </Button>
        <Button
          kind="secondary"
          icon="X"
          full
          active={!accepted}
          aria-pressed={!accepted}
          onClick={() => accepted && onStatus("REJECTED")}
        >
          {accepted ? t("card.reject") : t("card.rejected")}
        </Button>
        <Button kind="ghost" icon="Edit" full onClick={startEdit} disabled={editing}>
          {t("card.edit")}
        </Button>
      </div>
    </article>
  );
}
