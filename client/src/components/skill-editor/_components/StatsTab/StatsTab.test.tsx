import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SkillStats } from "@devdigest/shared";
import messages from "@messages/en/skills.json";

let stats: SkillStats;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/skills", () => ({
  useSkillStats: () => ({ data: stats, isLoading: false, isError: false, refetch: vi.fn() }),
}));

import { StatsTab } from "./StatsTab";
import { enabledAgentCount, percent } from "./helpers";

afterEach(cleanup);

const renderTab = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <StatsTab skillId="s1" />
    </NextIntlClientProvider>,
  );

describe("StatsTab", () => {
  it("renders the KPIs, the agents using the skill and the category legend", () => {
    stats = {
      used_by: [
        { agent_id: "a1", name: "Security Reviewer", enabled: true },
        { agent_id: "a2", name: "Custom Mentor", enabled: false },
      ],
      pull_rate: 0.71,
      accept_rate: 0.74,
      findings_30d: 96,
      findings_by_category: [
        { category: "security", count: 52 },
        { category: "bug", count: 20 },
      ],
    };
    renderTab();
    expect(screen.getByText("71")).toBeInTheDocument();
    expect(screen.getByText("96")).toBeInTheDocument();
    expect(screen.getAllByText("74").length).toBeGreaterThan(0);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getAllByText("Open")).toHaveLength(2);
    expect(screen.getByText("security")).toBeInTheDocument();
    expect(screen.getByText("52")).toBeInTheDocument();
  });

  it("shows — (not 0%) and an explanation when the skill has no runs yet", () => {
    stats = { used_by: [], pull_rate: null, accept_rate: null, findings_30d: 0, findings_by_category: [] };
    renderTab();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.getByText("No agent uses this skill yet.")).toBeInTheDocument();
    expect(screen.getByText("No findings yet.")).toBeInTheDocument();
  });
});

describe("stats helpers", () => {
  it("percent / enabledAgentCount", () => {
    expect(percent(0.745)).toBe(75);
    expect(percent(null)).toBeNull();
    expect(enabledAgentCount({ used_by: [{ agent_id: "a", name: "A", enabled: true }, { agent_id: "b", name: "B", enabled: false }] })).toBe(1);
  });
});
