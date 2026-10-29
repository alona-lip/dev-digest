/* DocRow — one document line: drag grip, checkbox, name + directory, type badge,
   Preview, ↑/↓. A native checkbox (the kit Toggle has no `disabled`). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { GripVertical } from "lucide-react";
import { Badge, Button, Icon } from "@devdigest/ui";
import { TYPE_COLORS } from "../../constants";
import { splitPath, type PickerRow } from "../../helpers";
import { s } from "../../styles";

export interface DocRowProps {
  row: PickerRow;
  /** Checked + enabled: the owner's own attachment. */
  checked: boolean;
  /** Locked inherited row: `via <skill>`, not removable. */
  inheritedFrom?: string;
  /** The owner's own attached row: it has a place in the order (grip + ↑/↓). */
  inOrder: boolean;
  /** Reordering is currently on (off while a filter is set). */
  orderable: boolean;
  dragging: boolean;
  isFirst: boolean;
  isLast: boolean;
  onToggle: () => void;
  onPreview: () => void;
  onMove: (delta: -1 | 1) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}

export function DocRow(p: DocRowProps) {
  const t = useTranslations("context");
  const { row } = p;
  const { name, dir } = splitPath(row.path);
  const locked = p.inheritedFrom !== undefined;
  // A too_large doc can't be newly attached; an attached one (or a missing one) can still be unchecked.
  const disabled = locked || (row.too_large && !row.attached);
  const note = locked
    ? t("picker.viaSkill", { name: p.inheritedFrom })
    : row.missing
      ? t("picker.missingHint")
      : row.too_large
        ? t("picker.tooLarge")
        : null;

  return (
    <div
      data-testid="doc-row"
      draggable={p.inOrder && p.orderable}
      onDragStart={p.onDragStart}
      onDragEnd={p.onDragEnd}
      onDragOver={(e) => p.inOrder && p.orderable && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (p.inOrder && p.orderable) p.onDrop();
      }}
      style={s.row(p.dragging, row.missing || locked)}
    >
      {p.inOrder ? (
        <span style={s.grip(p.orderable)} aria-hidden>
          <GripVertical size={16} />
        </span>
      ) : (
        <span style={s.gripSpacer} aria-hidden />
      )}
      <input
        type="checkbox"
        style={s.checkbox}
        checked={p.checked}
        disabled={disabled}
        onChange={p.onToggle}
        aria-label={t("picker.selectDocument", { path: row.path })}
      />
      <span style={s.names}>
        <span className="mono" style={s.fileName}>
          {name}
        </span>
        {dir && <span style={s.dir}>{dir}</span>}
        {note && <span style={s.note}>{note}</span>}
      </span>
      {row.missing && <Badge>{t("picker.status.missing")}</Badge>}
      {row.type && (
        <Badge color={TYPE_COLORS[row.type].color} bg={TYPE_COLORS[row.type].bg}>
          {t(`picker.type.${row.type}`)}
        </Badge>
      )}
      {!row.missing && (
        <Button kind="tertiary" size="sm" aria-label={t("picker.previewOf", { path: row.path })} onClick={p.onPreview}>
          {t("picker.preview")}
        </Button>
      )}
      {p.inOrder ? (
        <span style={s.arrows}>
          <button
            type="button"
            style={s.arrow}
            aria-label={t("picker.moveUp", { path: row.path })}
            disabled={!p.orderable || p.isFirst}
            onClick={() => p.onMove(-1)}
          >
            <Icon.ArrowUp size={14} />
          </button>
          <button
            type="button"
            style={s.arrow}
            aria-label={t("picker.moveDown", { path: row.path })}
            disabled={!p.orderable || p.isLast}
            onClick={() => p.onMove(1)}
          >
            <Icon.ArrowDown size={14} />
          </button>
        </span>
      ) : (
        <span style={s.arrowsSpacer} aria-hidden />
      )}
    </div>
  );
}
