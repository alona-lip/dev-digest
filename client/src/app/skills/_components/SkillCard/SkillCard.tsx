/* SkillCard — one skill in the Skills list: name, global toggle, delete,
   description, type + version + source badges and the usage rollups
   ("3 agents · 71% pull · 74% accept"). Delete only asks the parent to confirm. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Toggle } from "@devdigest/ui";
import type { SkillListItem } from "@devdigest/shared";
import { SkillTypeBadge, TYPE_COLORS } from "@/components/skill-type-badge";
import { formatRate } from "./helpers";
import { SOURCE_ICONS } from "./constants";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
  onDelete,
}: {
  skill: SkillListItem;
  active?: boolean;
  onClick?: () => void;
  /** Global switch: turns the skill on/off for EVERY agent. */
  onToggle?: (enabled: boolean) => void;
  onDelete?: () => void;
}) {
  const t = useTranslations("skills");
  const c = TYPE_COLORS[skill.type];
  const SourceIcon = Icon[SOURCE_ICONS[skill.source]];
  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)} data-testid="skill-card">
      <div style={s.headerRow}>
        <div style={s.iconBox(c.color, c.bg)}>
          <Icon.Sparkles size={15} />
        </div>
        <span className="mono" style={s.name}>
          {skill.name}
        </span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          </div>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title={t("card.delete", { name: skill.name })}
            aria-label={t("card.delete", { name: skill.name })}
            style={s.deleteBtn}
          >
            <Icon.Trash size={14} />
          </button>
        )}
      </div>
      <div style={s.description}>{skill.description}</div>
      <div style={s.badgeRow}>
        <SkillTypeBadge type={skill.type} />
        <Badge icon="GitCommit" mono>
          {t("preview.version", { version: skill.version })}
        </Badge>
        <span style={s.source}>
          <SourceIcon size={12} />
          {t(`listItem.source.${skill.source}`)}
        </span>
      </div>
      <div style={s.footer}>
        <span>{t("card.agents", { count: skill.agent_count })}</span>
        <span>{t("card.pull", { rate: formatRate(skill.pull_rate) })}</span>
        <span style={skill.accept_rate != null ? s.accept : undefined}>
          {t("card.accept", { rate: formatRate(skill.accept_rate) })}
        </span>
      </div>
    </div>
  );
}
