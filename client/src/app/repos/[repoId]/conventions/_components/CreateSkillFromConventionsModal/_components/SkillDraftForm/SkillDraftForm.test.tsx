import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import conventions from "@messages/en/conventions.json";
import skills from "@messages/en/skills.json";
import type { AgentListItem, ConventionSkillDraft } from "@devdigest/shared";
import { ToastProvider } from "@/lib/toast";

const create = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({
  useCreateConventionSkill: () => ({ mutate: create, isPending: false }),
}));

import { SkillDraftForm } from "./SkillDraftForm";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DRAFT: ConventionSkillDraft = {
  name: "repo-conventions",
  description: "Use when reviewing changes to payments-api: flag code that breaks its 3 house conventions.",
  type: "convention",
  enabled: true,
  body: "# repo-conventions\n\n## Always use async/await\n",
  accepted_count: 3,
  existing_skill: null,
};

const agent = (id: string, name: string) => ({ id, name }) as AgentListItem;
const AGENTS = [agent("a-sec", "Security Reviewer"), agent("a-gen", "General Reviewer")];

function renderForm(draft = DRAFT) {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions, skills }}>
      <ToastProvider>
        <SkillDraftForm repoId="r1" repoName="payments-api" draft={draft} agents={AGENTS} onClose={onClose} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
  return onClose;
}

describe("SkillDraftForm", () => {
  it("explains it merges accepted conventions and pre-fills every field from the draft", () => {
    renderForm();
    expect(screen.getByText("Create skill from conventions")).toBeInTheDocument();
    expect(screen.getByTestId("conventions-banner")).toHaveTextContent(
      "Merged from 3 accepted conventions in payments-api. Everything below is editable before you save.",
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("repo-conventions");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(DRAFT.description);
    expect(screen.getByRole("textbox", { name: "Skill body" })).toHaveValue(DRAFT.body);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Saved as v1 · added to Skills Lab")).toBeInTheDocument();
  });

  it("saves the edited body and metadata, linked to General Reviewer by default", async () => {
    const onClose = renderForm();
    create.mockImplementationOnce((_input, opts) => opts.onSuccess({ name: "team-rules", version: 1 }));

    const name = screen.getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "team-rules");
    await userEvent.type(screen.getByRole("textbox", { name: "Skill body" }), "Extra line.");
    await userEvent.click(screen.getByRole("switch"));
    await userEvent.click(screen.getByRole("button", { name: /Create skill/ }));

    expect(create).toHaveBeenCalledWith(
      {
        name: "team-rules",
        description: DRAFT.description,
        type: "convention",
        enabled: false,
        body: `${DRAFT.body}Extra line.`,
        agent_id: "a-gen",
      },
      expect.anything(),
    );
    expect(onClose).toHaveBeenCalled();
    expect(await screen.findByText("team-rules saved as v1 and linked to General Reviewer")).toBeInTheDocument();
  });

  it("links to the agent picked in the select", async () => {
    renderForm();
    const [, agentSelect] = screen.getAllByRole("combobox");
    await userEvent.selectOptions(agentSelect!, "a-sec");
    await userEvent.click(screen.getByRole("button", { name: /Create skill/ }));
    expect(create.mock.calls[0]![0]).toMatchObject({ agent_id: "a-sec" });
  });

  it("announces the next version when repo-conventions already exists", () => {
    renderForm({ ...DRAFT, existing_skill: { id: "s1", version: 2 } });
    expect(screen.getByText("Saved as v3 · added to Skills Lab")).toBeInTheDocument();
  });

  it("blocks saving with an empty name", async () => {
    renderForm();
    await userEvent.clear(screen.getByRole("textbox", { name: "Name" }));
    await userEvent.click(screen.getByRole("button", { name: /Create skill/ }));
    expect(create).not.toHaveBeenCalled();
    expect(within(screen.getByRole("alert")).getByText(/name/i)).toBeInTheDocument();
  });

  it("Cancel closes without saving", async () => {
    const onClose = renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
