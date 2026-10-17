import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { SkillListItem } from "@devdigest/shared";
import messages from "@messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

const push = vi.fn();
const update = vi.fn();
let SKILLS: SkillListItem[] = [];
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ id: "s2" }),
}));
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: update }),
  useImportSkillPreview: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateSkill: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { SkillsListPane } from "./SkillsListPane";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const sk = (id: string, name: string): SkillListItem => ({
  id,
  name,
  description: `${name} description`,
  type: "rubric",
  source: "manual",
  body: "b",
  enabled: true,
  version: 1,
  tokens: 1,
  created_at: "2026-01-01T00:00:00Z",
  agent_count: 0,
  pull_rate: null,
  accept_rate: null,
});

const renderPane = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillsListPane />
      </ToastProvider>
    </NextIntlClientProvider>,
  );

describe("SkillsListPane", () => {
  it("lists skills, filters by search, and opens one on click", async () => {
    SKILLS = [sk("s1", "alpha-rule"), sk("s2", "bravo-rule")];
    renderPane();
    expect(screen.getAllByTestId("skill-card")).toHaveLength(2);
    await userEvent.type(screen.getByLabelText("Search skills…"), "bravo");
    expect(screen.getAllByTestId("skill-card")).toHaveLength(1);
    await userEvent.click(screen.getByText("bravo-rule"));
    expect(push).toHaveBeenCalledWith("/skills/s2");
  });

  it("the card toggle is the global switch", async () => {
    SKILLS = [sk("s1", "alpha-rule")];
    renderPane();
    await userEvent.click(screen.getByRole("switch"));
    expect(update).toHaveBeenCalledWith({ id: "s1", patch: { enabled: false } });
  });

  it("Add Skill offers Create and Import", async () => {
    SKILLS = [sk("s1", "alpha-rule")];
    renderPane();
    await userEvent.click(screen.getByRole("button", { name: /Add Skill/ }));
    await userEvent.click(screen.getByText("Create skill"));
    expect(push).toHaveBeenCalledWith("/skills/new");
    await userEvent.click(screen.getByRole("button", { name: /Add Skill/ }));
    await userEvent.click(screen.getByText("Import from file"));
    expect(screen.getByText("Import skill")).toBeInTheDocument();
  });

  it("shows an empty state with an import CTA when the library is empty", () => {
    SKILLS = [];
    renderPane();
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
  });
});
