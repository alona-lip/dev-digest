/* SkillsTab — bind library skills to an agent: switch on to enable for THIS agent,
   drag (or ↑/↓) an ENABLED skill to reorder. List order IS the order of the skill
   blocks in the agent's prompt; a disabled skill keeps its place but can't be
   dragged. Every change is saved at once (optimistic, whole list). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { GripVertical } from "lucide-react";
import { ErrorState, Icon, Skeleton, Toggle } from "@devdigest/ui";
import { SkillTypeBadge } from "@/components/skill-type-badge";
import { useAgentSkills, useSetAgentSkills, useSkills } from "@/lib/hooks/skills";
import {
  countEnabled,
  filterRows,
  isOrderable,
  mergeSkillRows,
  moveRow,
  toggleRow,
  toPayload,
  type SkillRow,
} from "./helpers";
import { s } from "./styles";

export function SkillsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("agents");
  const router = useRouter();
  const skills = useSkills();
  const links = useAgentSkills(agentId);
  const save = useSetAgentSkills(agentId);
  const [filter, setFilter] = React.useState("");
  const [dragId, setDragId] = React.useState<string | null>(null);

  if (skills.isLoading || links.isLoading) return <Skeleton height={240} />;
  if (skills.isError || links.isError || !skills.data || !links.data) {
    return (
      <ErrorState
        title={t("skills.loadError")}
        onRetry={() => {
          void skills.refetch();
          void links.refetch();
        }}
      />
    );
  }

  const rows = mergeSkillRows(skills.data, links.data);
  const commit = (next: SkillRow[]) => {
    if (next !== rows) save.mutate(toPayload(next));
  };
  const visible = filterRows(rows, filter);
  const boundCount = rows.filter((r) => r.bound).length;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <span style={s.count}>{t("skills.enabledCount", { linked: countEnabled(rows), total: rows.length })}</span>
        <div style={s.filter}>
          <Icon.Search size={13} style={s.filterIcon} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("skills.filterPlaceholder")}
            aria-label={t("skills.filterPlaceholder")}
            style={s.filterInput}
          />
        </div>
      </div>
      <p style={s.hint}>{t("skills.orderHint")}</p>

      {rows.length === 0 ? (
        <div style={s.empty}>
          {t("skills.empty")}{" "}
          <button style={s.link} onClick={() => router.push("/skills")}>
            {t("skills.goToSkills")}
          </button>
        </div>
      ) : (
        visible.map((r) => {
          const index = rows.indexOf(r);
          // Reordering is off while filtering: indexes of a filtered list are not prompt positions.
          const orderable = isOrderable(r) && !filter;
          const droppable = r.bound && !filter;
          return (
            <div
              key={r.skill.id}
              data-testid="skill-row"
              draggable={orderable}
              onDragStart={() => setDragId(r.skill.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => droppable && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const from = rows.findIndex((x) => x.skill.id === dragId);
                setDragId(null);
                if (from >= 0 && droppable) commit(moveRow(rows, from, index));
              }}
              style={s.row(dragId === r.skill.id, !r.skill.enabled)}
            >
              <span style={s.grip(orderable)} aria-hidden>
                <GripVertical size={16} />
              </span>
              {/* The label names the switch and makes the skill name a click target too. */}
              <label style={s.toggleLabel}>
                <Toggle on={r.enabled} onChange={() => commit(toggleRow(rows, r.skill.id))} size={14} />
                <span className="mono" style={s.name}>
                  {r.skill.name}
                </span>
              </label>
              {!r.skill.enabled && <span style={s.globalOff}>{t("skills.globallyOff")}</span>}
              <SkillTypeBadge type={r.skill.type} />
              {orderable ? (
                <span style={s.arrows}>
                  <button
                    style={s.arrow}
                    aria-label={t("skills.moveUp", { name: r.skill.name })}
                    disabled={index === 0}
                    onClick={() => commit(moveRow(rows, index, index - 1))}
                  >
                    <Icon.ArrowUp size={14} />
                  </button>
                  <button
                    style={s.arrow}
                    aria-label={t("skills.moveDown", { name: r.skill.name })}
                    disabled={index >= boundCount - 1}
                    onClick={() => commit(moveRow(rows, index, index + 1))}
                  >
                    <Icon.ArrowDown size={14} />
                  </button>
                </span>
              ) : (
                <span style={s.arrowsSpacer} aria-hidden />
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
