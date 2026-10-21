import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

const push = vi.fn();
const create = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/hooks/skills", () => ({
  useCreateSkill: () => ({ mutate: create, isPending: false }),
}));

import { CreateSkillTab } from "./CreateSkillTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderTab = (onDone = vi.fn()) => {
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <CreateSkillTab onDone={onDone} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
  return onDone;
};

const CLEAN = { status: "clean", method: "pattern", findings: [], scanned_at: null };

async function fillIn() {
  await userEvent.type(screen.getAllByRole("textbox")[0]!, "my-skill");
  await userEvent.type(screen.getAllByRole("textbox")[1]!, "Use when X.");
  fireEvent.change(screen.getByLabelText("Skill body"), { target: { value: "Do Y." } });
}

describe("CreateSkillTab", () => {
  it("has name, description, type and a markdown body with Edit / Preview", async () => {
    renderTab();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Skill body"), { target: { value: "# Heading\n\nRule." } });
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
  });

  it("validates before posting, then creates a manual skill and opens it", async () => {
    create.mockImplementationOnce((_input: unknown, opts: { onSuccess: (s: object) => void }) =>
      opts.onSuccess({ id: "new1", name: "my-skill", scan: CLEAN }),
    );
    const onDone = renderTab();
    await userEvent.click(screen.getByRole("button", { name: "Create skill" }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Name is required.");

    await fillIn();
    await userEvent.click(screen.getByRole("button", { name: "Create skill" }));

    expect(create.mock.calls[0]![0]).toEqual({
      name: "my-skill",
      description: "Use when X.",
      type: "custom",
      body: "Do Y.",
      source: "manual",
    });
    expect(onDone).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/skills/new1");
    expect(await screen.findByText('Created "my-skill"')).toBeInTheDocument();
  });

  it("says so when the server saved the skill blocked by the injection scan", async () => {
    create.mockImplementationOnce((_input: unknown, opts: { onSuccess: (s: object) => void }) =>
      opts.onSuccess({ id: "new2", name: "my-skill", scan: { ...CLEAN, status: "injection" } }),
    );
    renderTab();
    await fillIn();
    await userEvent.click(screen.getByRole("button", { name: "Create skill" }));
    expect(await screen.findByText(/saved but blocked: prompt injection detected/)).toBeInTheDocument();
    expect(push).toHaveBeenCalledWith("/skills/new2");
  });
});
