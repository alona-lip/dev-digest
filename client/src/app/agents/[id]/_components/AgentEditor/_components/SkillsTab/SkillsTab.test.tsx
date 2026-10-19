import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { AgentSkillLink, SkillListItem } from "@devdigest/shared";
import messages from "@messages/en/agents.json";
import skillMessages from "@messages/en/skills.json";

const save = vi.fn();
let SKILLS: SkillListItem[];
let LINKS: AgentSkillLink[];
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
  useAgentSkills: () => ({ data: LINKS, isLoading: false, isError: false, refetch: vi.fn() }),
  useSetAgentSkills: () => ({ mutate: save }),
}));

import { SkillsTab } from "./SkillsTab";

afterEach(() => {
  cleanup();
  save.mockClear();
});

const sk = (id: string, name: string, enabled = true): SkillListItem => ({
  id,
  name,
  description: "d",
  type: "security",
  source: "manual",
  body: "b",
  enabled,
  version: 1,
  tokens: 1,
  created_at: "2026-01-01T00:00:00Z",
  agent_count: 0,
  pull_rate: null,
  accept_rate: null,
});

const renderTab = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages, skills: skillMessages }}>
      <SkillsTab agentId="ag" />
    </NextIntlClientProvider>,
  );

describe("agent SkillsTab", () => {
  it("shows every library skill, checked state, and the 'N of M enabled' counter", () => {
    SKILLS = [sk("a", "pr-quality-rubric"), sk("b", "no-then-chains"), sk("c", "phantom-api-gate", false)];
    LINKS = [
      { agent_id: "ag", skill_id: "a", order: 0, enabled: true },
      { agent_id: "ag", skill_id: "b", order: 1, enabled: false },
    ];
    renderTab();
    expect(screen.getByText("1 of 3 enabled")).toBeInTheDocument();
    const rows = screen.getAllByTestId("skill-row");
    expect(rows.map((r) => within(r).getByText(/-/).textContent)).toEqual([
      "pr-quality-rubric",
      "no-then-chains",
      "phantom-api-gate",
    ]);
    expect(within(rows[0]!).getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    expect(within(rows[1]!).getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
    expect(within(rows[2]!).getByText("off globally")).toBeInTheDocument();
  });

  it("ticking an unbound skill saves the whole bound list with it appended", async () => {
    SKILLS = [sk("a", "alpha"), sk("b", "bravo")];
    LINKS = [{ agent_id: "ag", skill_id: "a", order: 0, enabled: true }];
    renderTab();
    await userEvent.click(within(screen.getAllByTestId("skill-row")[1]!).getByRole("checkbox"));
    expect(save).toHaveBeenCalledWith([
      { skill_id: "a", enabled: true },
      { skill_id: "b", enabled: true },
    ]);
  });

  it("the arrow buttons reorder (this order is the prompt order)", async () => {
    SKILLS = [sk("a", "alpha"), sk("b", "bravo")];
    LINKS = [
      { agent_id: "ag", skill_id: "a", order: 0, enabled: true },
      { agent_id: "ag", skill_id: "b", order: 1, enabled: true },
    ];
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: "Move bravo up" }));
    expect(save).toHaveBeenCalledWith([
      { skill_id: "b", enabled: true },
      { skill_id: "a", enabled: true },
    ]);
    expect(screen.getByRole("button", { name: "Move alpha up" })).toBeDisabled();
  });

  it("unbound skills cannot be reordered", () => {
    SKILLS = [sk("a", "alpha"), sk("b", "bravo")];
    LINKS = [{ agent_id: "ag", skill_id: "a", order: 0, enabled: true }];
    renderTab();
    expect(screen.queryByRole("button", { name: "Move bravo up" })).not.toBeInTheDocument();
    expect(screen.getAllByTestId("skill-row")[1]).toHaveAttribute("draggable", "false");
  });

  it("only ENABLED skills can be dragged; a disabled one keeps its place", () => {
    SKILLS = [sk("a", "alpha"), sk("b", "bravo"), sk("c", "charlie")];
    LINKS = [
      { agent_id: "ag", skill_id: "a", order: 0, enabled: true },
      { agent_id: "ag", skill_id: "b", order: 1, enabled: false },
      { agent_id: "ag", skill_id: "c", order: 2, enabled: true },
    ];
    renderTab();
    const rows = screen.getAllByTestId("skill-row");
    expect(rows.map((r) => r.getAttribute("draggable"))).toEqual(["true", "false", "true"]);
    expect(screen.queryByRole("button", { name: "Move bravo up" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move charlie up" })).toBeInTheDocument();
  });

  it("filtering hides rows and turns reordering off (no partial-list moves)", async () => {
    SKILLS = [sk("a", "alpha"), sk("b", "bravo")];
    LINKS = [
      { agent_id: "ag", skill_id: "a", order: 0, enabled: true },
      { agent_id: "ag", skill_id: "b", order: 1, enabled: true },
    ];
    renderTab();
    await userEvent.type(screen.getByLabelText("Filter skills…"), "brav");
    expect(screen.getAllByTestId("skill-row")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Move/ })).not.toBeInTheDocument();
  });
});
