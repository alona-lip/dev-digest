import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentSkillLink, SkillListItem } from "@devdigest/shared";
import messages from "@messages/en/agents.json";
import skillMessages from "@messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
}));

// The Skills tab reads the library + this agent's bindings and uses the router.
const SKILL = (id: string, name: string, enabled = true): SkillListItem => ({
  id,
  name,
  description: `${name} description`,
  type: "rubric",
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
const SKILLS: SkillListItem[] = [SKILL("s1", "branch-coverage"), SKILL("s2", "corner-cases")];
const LINKS: AgentSkillLink[] = [{ agent_id: "ag1", skill_id: "s1", order: 0, enabled: true }];
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
  useAgentSkills: () => ({ data: LINKS, isLoading: false, isError: false, refetch: vi.fn() }),
  useSetAgentSkills: () => ({ mutate: vi.fn() }),
}));

import { AgentEditor } from "./AgentEditor";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages, skills: skillMessages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });
});

describe("Agent Editor — tabs", () => {
  it("offers the Config and Skills tabs", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByRole("button", { name: "Config" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skills" })).toBeInTheDocument();
  });

  it("tab=skills shows the skill list instead of the Config form", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="skills" onTab={() => {}} />);
    expect(screen.getByText("1 of 2 enabled")).toBeInTheDocument();
    expect(screen.getAllByTestId("skill-row")).toHaveLength(2);
    expect(screen.queryByText("Save agent")).not.toBeInTheDocument();
  });

  it("tab=config does not render the skill list", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.queryByTestId("skill-row")).not.toBeInTheDocument();
  });

  it("clicking the Skills tab asks the view to switch to it", async () => {
    const onTab = vi.fn();
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={onTab} />);
    await userEvent.click(screen.getByRole("button", { name: "Skills" }));
    expect(onTab).toHaveBeenCalledWith("skills");
  });
});
