import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { SkillListItem } from "@devdigest/shared";
import messages from "@messages/en/skills.json";
import { SkillCard } from "./SkillCard";

afterEach(cleanup);

const SKILL: SkillListItem = {
  id: "s1",
  name: "pr-quality-rubric",
  description: "Rubric for evaluating overall PR quality",
  type: "rubric",
  source: "manual",
  body: "# Rubric",
  enabled: true,
  version: 5,
  tokens: 166,
  created_at: "2026-03-02T00:00:00Z",
  agent_count: 3,
  pull_rate: 0.714,
  accept_rate: 0.74,
};

const renderCard = (ui: React.ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );

describe("SkillCard", () => {
  it("shows name, type, source and the usage rollups", () => {
    renderCard(<SkillCard skill={SKILL} />);
    expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("3 agents")).toBeInTheDocument();
    expect(screen.getByText("71% pull")).toBeInTheDocument();
    expect(screen.getByText("74% accept")).toBeInTheDocument();
  });

  it("shows — (not 0%) when there is no data yet", () => {
    renderCard(<SkillCard skill={{ ...SKILL, agent_count: 1, pull_rate: null, accept_rate: null }} />);
    expect(screen.getByText("— pull")).toBeInTheDocument();
    expect(screen.getByText("— accept")).toBeInTheDocument();
    expect(screen.getByText("1 agent")).toBeInTheDocument();
  });

  it("the toggle flips the GLOBAL switch without opening the card", async () => {
    const onToggle = vi.fn();
    const onClick = vi.fn();
    renderCard(<SkillCard skill={SKILL} onToggle={onToggle} onClick={onClick} />);
    await userEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onClick).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("pr-quality-rubric"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
