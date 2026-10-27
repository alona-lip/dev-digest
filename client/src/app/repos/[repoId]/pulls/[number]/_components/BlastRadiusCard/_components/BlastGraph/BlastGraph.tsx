/* BlastGraph — hand-drawn SVG of the blast radius in 3 columns: changed symbols,
   their callers, the endpoints/crons reached. Layout is the pure `layoutGraph`.
   Hovering a changed symbol lights it, its callers, its endpoints/crons and their
   edges, and dims the rest (`connectedTo`).
   The "Open full size" button under the graph opens the same graph full size in a
   Modal (close ✕, backdrop click or Esc); the copy inside the modal is not
   expandable. A click on the graph itself does nothing, so hovering stays free. The kit Modal does no keyboard or focus handling, so GraphModal adds it:
   focus moves to ✕ on open, Tab stays inside, and focus returns to the opener on close. */
"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import type { PrBlastRadius } from "@devdigest/shared";
import { GRAPH, LEGEND } from "./constants";
import { connectedTo, layoutGraph, truncate } from "./helpers";
import { useDialogFocus } from "@/lib/dialog-focus";
import { s, NODE_COLOR, DIMMED_OPACITY } from "./styles";

export function BlastGraph({ blast, expandable = true }: { blast: PrBlastRadius; expandable?: boolean }) {
  const t = useTranslations("blast");
  const layout = useMemo(() => layoutGraph(blast), [blast]);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const lit = useMemo(() => (hovered ? connectedTo(layout, hovered) : null), [layout, hovered]);
  // Stable, so a re-render (e.g. a background refetch) does not re-run GraphModal's focus effect.
  const closeModal = useCallback(() => setOpen(false), []);

  if (blast.downstream.length === 0) return <p style={s.empty}>{t("graph.empty")}</p>;

  return (
    <div>
      <svg
        role="img"
        aria-label={t("graph.ariaLabel")}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={s.svg}
      >
        {layout.edges.map((e) => {
          const on = lit?.has(e.id) ?? false;
          return (
            <path
              key={e.id}
              d={e.path}
              fill="none"
              stroke={on ? NODE_COLOR.symbol : "var(--border-strong)"}
              strokeWidth={on ? 1.5 : 1}
              opacity={lit && !on ? DIMMED_OPACITY : undefined}
              style={s.fade}
            />
          );
        })}
        {layout.nodes.map((n) => {
          const on = lit?.has(n.id) ?? false;
          const isSymbol = n.kind === "symbol";
          return (
            <g
              key={n.id}
              opacity={lit && !on ? DIMMED_OPACITY : undefined}
              style={isSymbol ? s.symbolNode : s.fade}
              onMouseEnter={isSymbol ? () => setHovered(n.id) : undefined}
              onMouseLeave={isSymbol ? () => setHovered(null) : undefined}
            >
              <title>{n.label}</title>
              <rect
                x={n.x}
                y={n.y}
                width={n.width}
                height={n.height}
                rx={5}
                fill="var(--bg-surface)"
                stroke={NODE_COLOR[n.kind]}
                strokeWidth={on ? 2 : 1}
              />
              <text x={n.x + 8} y={n.y + n.height / 2} dominantBaseline="central" style={s.nodeText}>
                {truncate(n.label, GRAPH.MAX_LABEL_CHARS)}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={s.legendRow}>
        <ul style={s.legend}>
          {LEGEND.map((kind) => (
            <li key={kind} style={s.legendItem}>
              <span style={{ ...s.swatch, borderColor: NODE_COLOR[kind] }} aria-hidden />
              {t(`graph.legend.${kind}`)}
            </li>
          ))}
        </ul>
        {expandable && (
          <Button kind="ghost" size="sm" onClick={() => setOpen(true)}>
            {t("graph.open")}
          </Button>
        )}
      </div>
      {open && <GraphModal blast={blast} onClose={closeModal} />}
    </div>
  );
}

function GraphModal({ blast, onClose }: { blast: PrBlastRadius; onClose: () => void }) {
  const t = useTranslations("blast");
  const bodyRef = useRef<HTMLDivElement>(null);

  // ✕ is the first focusable control in the dialog (the graph inside is not expandable).
  useDialogFocus(bodyRef, onClose);

  return (
    <Modal width={1100} title={t("title")} onClose={onClose}>
      <div ref={bodyRef} style={s.modalBody}>
        <BlastGraph blast={blast} expandable={false} />
      </div>
    </Modal>
  );
}
