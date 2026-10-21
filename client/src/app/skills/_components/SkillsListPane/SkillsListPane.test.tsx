import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { SkillListItem } from "@devdigest/shared";
import messages from "@messages/en/skills.json";
import common from "@messages/en/common.json";
import { ToastProvider } from "@/lib/toast";

const push = vi.fn();
const update = vi.fn();
const del = vi.fn();
let SKILLS: SkillListItem[] = [];
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ id: "s2" }),
}));
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: update }),
  useImportSkillPreview: () => ({ mutate: vi.fn(), isPending: false }),
  useImportSkillUrlPreview: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSkill: () => ({ mutate: del, isPending: false }),
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
  scan: { status: "clean", method: "pattern", findings: [], scanned_at: null },
  agent_count: 0,
  pull_rate: null,
  accept_rate: null,
});

const renderPane = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages, common }}>
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

  it("Add Skill is one button that opens the Add skill modal on the Create tab", async () => {
    SKILLS = [sk("s1", "alpha-rule")];
    renderPane();
    await userEvent.click(screen.getByRole("button", { name: "Add Skill" }));
    // Creation happens in a modal, not on a separate page — and there is no menu in between.
    expect(screen.getByRole("dialog")).toHaveTextContent("Add skill");
    expect(screen.getByRole("button", { name: "Import from URL" })).toBeInTheDocument();
    expect(screen.getByLabelText("Skill body")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a skill blocked by the injection scan cannot be switched on from its card", async () => {
    SKILLS = [{ ...sk("s1", "evil-rule"), enabled: false, scan: { status: "injection", method: "pattern", findings: [], scanned_at: null } }];
    renderPane();
    await userEvent.click(screen.getByRole("switch"));
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByTitle("Blocked: prompt injection detected")).toBeInTheDocument();
  });

  it("a card's Delete asks for confirmation; only Delete in the dialog deletes", async () => {
    SKILLS = [sk("s1", "alpha-rule"), sk("s2", "bravo-rule")];
    renderPane();
    await userEvent.click(screen.getByRole("button", { name: "Delete alpha-rule" }));
    expect(screen.getByText('Delete skill "alpha-rule"?')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(del).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Delete alpha-rule" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(del).toHaveBeenCalledWith("s1", expect.anything());
  });

  it("deleting the open skill returns to /skills", async () => {
    SKILLS = [sk("s2", "bravo-rule")];
    del.mockImplementationOnce((_id: string, opts: { onSuccess: () => void }) => opts.onSuccess());
    renderPane();
    await userEvent.click(screen.getByRole("button", { name: "Delete bravo-rule" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(push).toHaveBeenCalledWith("/skills");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows an empty state whose import CTA opens the modal on From file", async () => {
    SKILLS = [];
    renderPane();
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Import from file" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Add skill");
    expect(screen.getByTestId("skill-file-input")).toBeInTheDocument();
  });
});
