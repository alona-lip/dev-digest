/* BlastTree — one collapsible group per changed symbol: its callers as file:line links
   (GitHub blob at the PR head) plus the endpoint and cron chips reached through them. */
"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import { githubBlobUrl } from "@/lib/github-urls";
import type { DownstreamImpact } from "@devdigest/shared";
import { s } from "./styles";

export interface BlastTreeProps {
  groups: DownstreamImpact[];
  repoFullName: string | null;
  headSha: string;
}

export function BlastTree({ groups, repoFullName, headSha }: BlastTreeProps) {
  const t = useTranslations("blast");
  // The most important (first) group starts expanded.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(groups[0] ? [groups[0].symbol] : []));

  const toggle = (symbol: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(symbol)) next.add(symbol);
      return next;
    });

  return (
    <ul style={s.list}>
      {groups.map((g) => {
        const expanded = open.has(g.symbol);
        const Chevron = expanded ? Icon.ChevronDown : Icon.ChevronRight;
        return (
          <li key={g.symbol} style={s.group}>
            <button
              type="button"
              style={s.header}
              aria-expanded={expanded}
              aria-label={t(expanded ? "collapse" : "expand", { symbol: g.symbol })}
              onClick={() => toggle(g.symbol)}
            >
              <Chevron size={14} aria-hidden />
              <span style={s.symbol}>{g.symbol}</span>
              <span style={s.count}>{t("callerCount", { count: g.callers.length })}</span>
            </button>
            {expanded && (
              <div style={s.body}>
                <ul style={s.callers}>
                  {g.callers.map((c) => {
                    const label = `${c.file}:${c.line}`;
                    return (
                      <li key={`${c.file}:${c.line}:${c.name}`} style={s.caller}>
                        {repoFullName ? (
                          <a
                            href={githubBlobUrl(repoFullName, headSha, c.file, c.line)}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={s.link}
                          >
                            {label}
                          </a>
                        ) : (
                          <span style={s.path}>{label}</span>
                        )}
                        <span style={s.callerName}>{c.name}</span>
                      </li>
                    );
                  })}
                </ul>
                {(g.endpoints_affected.length > 0 || g.crons_affected.length > 0) && (
                  <div style={s.chips}>
                    {g.endpoints_affected.map((e) => (
                      <Badge key={`e:${e}`} icon="Globe" mono color="var(--info)" bg="var(--info-bg)">
                        {e}
                      </Badge>
                    ))}
                    {g.crons_affected.map((c) => (
                      <Badge key={`c:${c}`} icon="Clock" mono color="var(--warn)" bg="var(--warn-bg)">
                        {c}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
