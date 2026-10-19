/* EvidenceBlock — the code that proves a convention: `file:lines` header with a copy
   button, then the snippet as it is in the file (sliced by the server, not the model). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { COPY_FEEDBACK_MS } from "./constants";
import { lineRange } from "./helpers";
import { s } from "./styles";

export function EvidenceBlock({
  path,
  startLine,
  endLine,
  snippet,
}: {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
}) {
  const t = useTranslations("conventions");
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => clearTimeout(id);
  }, [copied]);

  const copyLabel = copied ? t("card.copied") : t("card.copy");

  const copy = () => {
    void navigator.clipboard?.writeText(snippet);
    setCopied(true);
  };

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <span className="mono" style={s.location}>
          {path}:{lineRange(startLine, endLine)}
        </span>
        <button type="button" title={copyLabel} aria-label={copyLabel} onClick={copy} style={s.copy}>
          {copied ? <Icon.Check size={13} /> : <Icon.Copy size={13} />}
        </button>
      </div>
      <pre className="mono" style={s.code}>
        {snippet}
      </pre>
    </div>
  );
}
