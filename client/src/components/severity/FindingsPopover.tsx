/* FindingsPopover — hover/focus preview used by both the PR list's FINDINGS
   column and the PR-detail Timeline tiles. Strictly read-only in the sense
   that matters: severity icon, title, category, file:line, confidence, a
   truncated rationale — no buttons, no onClick anywhere inside (Accept/
   Dismiss only exist on the PR-detail FindingCard, a different component
   with its own network calls). It IS mouse-interactive though: the list can
   be longer than the fixed max-height, so the popover must accept hover and
   wheel-scroll like any scrollable panel — `pointer-events: none` would
   block scrolling entirely, not just clicks.

   Rendered through a PORTAL into document.body, positioned via the caller's
   `anchorRect` (a live getBoundingClientRect() snapshot), not CSS
   `position: absolute` relative to a DOM ancestor. Every place this popover
   opens from sits inside an `overflow: hidden` ancestor somewhere up the tree
   (the PR-list table card clips rounded corners; the same is true elsewhere) —
   an absolutely-positioned popover gets silently clipped to nothing there. A
   portal escapes any number of such ancestors regardless of how deep they are.

   Because it's a portal, moving the cursor from the trigger onto the popover
   is a real mouseleave on the trigger at the DOM level (they're not nested).
   The caller's `useFindingsPopoverAnchor()` hook debounces the close and
   `onMouseEnter`/`onMouseLeave` below cancel/reschedule it, so trigger +
   popover behave as one hoverable region instead of closing mid-transit.
   Two modes: flat `findings` (one run — the Timeline) or `groups` (the PR
   list, one section per agent's latest review, each headed by the agent's
   name, its own non-interactive pills and its own score ring — see
   server/specs/pr-list-findings-by-agent.md).

   See client/specs/severity-filter.md. */
"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Icon, SEV, CAT, CircularScore } from "@devdigest/ui";
import type { Finding, PrAgentFindings } from "@devdigest/shared";
import { SeverityPills } from "./SeverityPills";

const WIDTH = 360;
const GAP = 6;

export function FindingsPopover({
  findings,
  groups,
  total,
  anchorRect,
  popoverRef,
  onMouseEnter,
  onMouseLeave,
}: {
  /** Flat mode — every finding of ONE run (the PR-detail Timeline). */
  findings?: Finding[];
  /** Grouped mode — one section per agent (the PR list). Wins over `findings`.
   *  Groups with no findings are skipped. */
  groups?: PrAgentFindings[] | null;
  /** Full count for the header. */
  total: number;
  /** Live snapshot of the hovered element's box, taken by the caller on open. */
  anchorRect: DOMRect | null;
  /** From `useFindingsPopoverAnchor()` — lets the page-scroll listener tell
   *  "the popover's own list scrolled" apart from "the page scrolled" (the
   *  former must NOT close it; see the hook's comment). */
  popoverRef?: React.RefObject<HTMLDivElement | null>;
  /** From the caller's `useFindingsPopoverAnchor().popoverHandlers` — keeps
   *  the popover open while the cursor is over it (see file header). */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const t = useTranslations("prReview");
  if (!anchorRect || typeof document === "undefined") return null;

  // Right-align instead of left-align once the default position would run
  // past the viewport edge — the only clamping this popover does; it does
  // not reposition on resize (it closes on scroll instead, see callers).
  const overflowsRight = anchorRect.left + WIDTH > window.innerWidth;
  const left = overflowsRight ? Math.max(8, anchorRect.right - WIDTH) : anchorRect.left;

  const visibleGroups = groups ? groups.filter((g) => g.findings.length > 0) : null;

  return createPortal(
    <div
      ref={popoverRef}
      role="tooltip"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed",
        top: anchorRect.bottom + GAP,
        left,
        zIndex: 1000,
        width: WIDTH,
        maxHeight: 420,
        overflowY: "auto",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 12px 32px rgba(0,0,0,.35)",
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          marginBottom: 10,
        }}
      >
        {visibleGroups
          ? t("severity.popoverTitleAgents", { count: total, agents: visibleGroups.length })
          : t("severity.popoverTitle", { count: total })}
      </div>
      {visibleGroups ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {visibleGroups.map((g) => (
            <section key={g.review_id} aria-label={g.agent_name ?? t("severity.unknownAgent")}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  paddingBottom: 6,
                  marginBottom: 10,
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {g.agent_name ?? t("severity.unknownAgent")}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  {/* No onSelect — the popover stays strictly read-only. */}
                  <SeverityPills compact counts={g.findings_by_severity} />
                  {/* This agent's own score; the row's ring is the PR-level one. */}
                  {g.score != null && <CircularScore score={g.score} size={28} stroke={2.5} />}
                </span>
              </div>
              <FindingList findings={g.findings} />
            </section>
          ))}
        </div>
      ) : (
        <FindingList findings={findings ?? []} />
      )}
    </div>,
    document.body,
  );
}

function FindingList({ findings }: { findings: Finding[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {findings.map((f) => (
        <FindingItem key={f.id} finding={f} />
      ))}
    </div>
  );
}

function FindingItem({ finding: f }: { finding: Finding }) {
  const t = useTranslations("prReview");
  const meta = SEV[f.severity];
  const SevIcon = Icon[meta.icon];
  const cat = CAT[f.category];
  const CatIcon = cat ? Icon[cat.icon] : null;
  const lines = f.end_line !== f.start_line ? `${f.start_line}-${f.end_line}` : `${f.start_line}`;
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <SevIcon size={14} style={{ color: meta.c, marginTop: 2, flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
          {f.title}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            fontSize: 11.5,
            color: "var(--text-muted)",
            marginTop: 3,
          }}
        >
          {cat && CatIcon && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <CatIcon size={11} />
              {cat.label}
            </span>
          )}
          <span className="mono">
            {f.file}:{lines}
          </span>
          <span className="tnum">
            {t("severity.confidence", { pct: Math.round(f.confidence * 100) })}
          </span>
        </div>
        <p
          style={{
            fontSize: 12,
            color: "var(--text-secondary)",
            marginTop: 4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {f.rationale}
        </p>
      </div>
    </div>
  );
}

export default FindingsPopover;
