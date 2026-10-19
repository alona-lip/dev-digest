/* CodeTextarea — monospace markdown editor with a line-number gutter, a file
   header (name · unsaved badge · token count). No syntax highlighting on purpose:
   the Preview tab renders the markdown. */
"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import { s } from "./styles";

export function CodeTextarea({
  value,
  onChange,
  fileName,
  unsavedLabel,
  unsaved,
  tokensLabel,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  fileName: string;
  unsavedLabel: string;
  unsaved: boolean;
  tokensLabel: string;
  ariaLabel: string;
}) {
  const gutterRef = React.useRef<HTMLDivElement>(null);
  const lines = value.split("\n").length;
  return (
    <div style={s.wrap}>
      <div style={s.bar}>
        <Icon.FileText size={14} style={{ color: "var(--text-muted)" }} />
        <span className="mono" style={s.file}>
          {fileName}
        </span>
        {unsaved && <span style={s.unsaved}>{unsavedLabel}</span>}
        <span className="mono" style={s.tokens} data-testid="body-tokens">
          {tokensLabel}
        </span>
      </div>
      <div style={s.editor}>
        <div ref={gutterRef} aria-hidden style={s.gutter}>
          {Array.from({ length: lines }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          className="mono"
          aria-label={ariaLabel}
          value={value}
          wrap="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => {
            if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          style={s.textarea}
        />
      </div>
    </div>
  );
}
