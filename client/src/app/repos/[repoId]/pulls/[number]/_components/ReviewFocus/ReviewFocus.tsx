/* ReviewFocus — full-width list of where to start reading: `file:line — reason`, in the
   stored order. Plain text only; clicking opens the file in the diff when it is part of it. */
"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import type { ReviewFocusItem } from "@devdigest/shared";
import { s } from "./styles";

export interface ReviewFocusProps {
  items: readonly ReviewFocusItem[];
  renderedFiles?: readonly string[];
  onOpenFile?: (file: string, line: number | null) => void;
}

export function ReviewFocus({ items, renderedFiles = [], onOpenFile = () => {} }: ReviewFocusProps) {
  const t = useTranslations("brief");
  const [missing, setMissing] = useState<number | null>(null);

  const open = (item: ReviewFocusItem, index: number) => {
    if (renderedFiles.includes(item.file)) {
      setMissing(null);
      onOpenFile(item.file, item.line);
    } else {
      setMissing(index);
    }
  };

  return (
    <section style={s.section}>
      <SectionLabel
        icon="ListChecks"
        right={
          items.length > 0 ? (
            <span style={s.badge} aria-label={t("reviewFocus.count", { count: items.length })}>
              {items.length}
            </span>
          ) : undefined
        }
      >
        {t("reviewFocus.title")}
      </SectionLabel>
      {items.length === 0 ? (
        <p style={s.empty}>{t("noFocus")}</p>
      ) : (
        <ul style={s.list}>
          {items.map((item, i) => {
            const location = `${item.file}:${item.line}`;
            return (
              <li key={`${i}-${location}`}>
                <button
                  type="button"
                  style={s.item}
                  aria-label={t("focusItemAria", { location })}
                  onClick={() => open(item, i)}
                >
                  <span style={s.location}>{location}</span>
                  <span aria-hidden="true">—</span>
                  <span style={s.reason}>{item.reason}</span>
                </button>
                {missing === i && (
                  <span role="status" style={s.notice}>
                    {t("fileNotInDiff")}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
