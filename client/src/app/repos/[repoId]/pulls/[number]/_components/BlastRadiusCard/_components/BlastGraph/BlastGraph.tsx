/* BlastGraph — hand-drawn SVG of the blast radius in 3 columns: changed symbols,
   their callers, the endpoints/crons reached. Layout is the pure `layoutGraph`. */
"use client";

import React, { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { PrBlastRadius } from "@devdigest/shared";
import { GRAPH, LEGEND } from "./constants";
import { layoutGraph, truncate } from "./helpers";
import { s, NODE_COLOR } from "./styles";

export function BlastGraph({ blast }: { blast: PrBlastRadius }) {
  const t = useTranslations("blast.graph");
  const layout = useMemo(() => layoutGraph(blast), [blast]);

  if (blast.downstream.length === 0) return <p style={s.empty}>{t("empty")}</p>;

  return (
    <div>
      <svg
        role="img"
        aria-label={t("ariaLabel")}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={s.svg}
      >
        {layout.edges.map((e) => (
          <path key={e.id} d={e.path} fill="none" stroke="var(--border-strong)" strokeWidth={1} />
        ))}
        {layout.nodes.map((n) => (
          <g key={n.id}>
            <title>{n.label}</title>
            <rect
              x={n.x}
              y={n.y}
              width={n.width}
              height={n.height}
              rx={5}
              fill="var(--bg-surface)"
              stroke={NODE_COLOR[n.kind]}
            />
            <text x={n.x + 8} y={n.y + n.height / 2} dominantBaseline="central" style={s.nodeText}>
              {truncate(n.label, GRAPH.MAX_LABEL_CHARS)}
            </text>
          </g>
        ))}
      </svg>
      <ul style={s.legend}>
        {LEGEND.map((kind) => (
          <li key={kind} style={s.legendItem}>
            <span style={{ ...s.swatch, borderColor: NODE_COLOR[kind] }} aria-hidden />
            {t(`legend.${kind}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
