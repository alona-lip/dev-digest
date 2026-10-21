/* StatsTab — how a skill performs. All numbers come from runs where the skill was
   IN THE PROMPT (last 30 days): a correlation to read with care, not proof. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PieChart, Pie, Cell } from "recharts";
import { CircularScore, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { useSkillStats } from "@/lib/hooks/skills";
import { categoryColor, enabledAgentCount, percent } from "./helpers";
import { s } from "./styles";

function Tile({
  label,
  value,
  suffix,
  ring,
}: {
  label: string;
  value: string;
  suffix?: string;
  ring?: number | null;
}) {
  return (
    <div style={s.tile}>
      <div>
        <div style={s.tileLabel}>{label}</div>
        <div className="tnum" style={s.tileValue}>
          {value}
          {suffix && value !== "—" && <span style={s.tileSuffix}>{suffix}</span>}
        </div>
      </div>
      {ring != null && <CircularScore score={ring} size={36} stroke={3} />}
    </div>
  );
}

export function StatsTab({ skillId }: { skillId: string }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: stats, isLoading, isError, refetch } = useSkillStats(skillId);

  if (isLoading) return <Skeleton height={260} />;
  if (isError || !stats) return <ErrorState title={t("stats.loadError")} onRetry={() => refetch()} />;

  const pull = percent(stats.pull_rate);
  const accept = percent(stats.accept_rate);
  const total = stats.findings_by_category.reduce((n, c) => n + c.count, 0);
  const agents = enabledAgentCount(stats);

  return (
    <div style={s.wrap}>
      <p style={s.note}>{t("stats.note")}</p>
      <div style={s.tiles}>
        <Tile label={t("stats.usedBy")} value={String(agents)} suffix={t("stats.agentsSuffix", { count: agents })} />
        <Tile label={t("stats.pullFrequency")} value={pull == null ? "—" : String(pull)} suffix="%" />
        <Tile label={t("stats.acceptRate")} value={accept == null ? "—" : String(accept)} suffix="%" ring={accept} />
        <Tile label={t("stats.findings30d")} value={String(stats.findings_30d)} />
      </div>
      <div style={s.panels}>
        <div style={s.panel}>
          <div style={s.panelTitle}>
            <Icon.Cpu size={13} />
            {t("stats.agentsUsing")}
          </div>
          {stats.used_by.length === 0 ? (
            <div style={s.empty}>{t("stats.noAgents")}</div>
          ) : (
            stats.used_by.map((a) => (
              <div key={a.agent_id} style={{ ...s.agentRow, opacity: a.enabled ? 1 : 0.6 }}>
                <Icon.Cpu size={14} style={{ color: "var(--accent)" }} />
                <span style={s.agentName}>{a.name}</span>
                <button style={s.open} onClick={() => router.push(`/agents/${a.agent_id}?tab=skills`)}>
                  {t("stats.open")}
                </button>
              </div>
            ))
          )}
        </div>
        <div style={s.panel}>
          <div style={s.panelTitle}>
            <Icon.Tag size={13} />
            {t("stats.byCategory")}
          </div>
          {total === 0 ? (
            <div style={s.empty}>{t("stats.noFindings")}</div>
          ) : (
            <div style={s.donutRow}>
              <PieChart width={130} height={130} role="img" aria-label={t("stats.byCategory")}>
                <Pie
                  data={stats.findings_by_category}
                  dataKey="count"
                  nameKey="category"
                  innerRadius={44}
                  outerRadius={65}
                  startAngle={90}
                  endAngle={-270}
                  paddingAngle={2}
                  isAnimationActive={false}
                  stroke="none"
                >
                  {stats.findings_by_category.map((c) => (
                    <Cell key={c.category} fill={categoryColor(c.category)} />
                  ))}
                </Pie>
              </PieChart>
              <div style={s.legend}>
                {stats.findings_by_category.map((c) => (
                  <div key={c.category} style={s.legendRow}>
                    <span style={s.swatch(categoryColor(c.category))} />
                    <span style={s.legendLabel}>{c.category}</span>
                    <span className="mono tnum" style={s.legendValue}>
                      {c.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
