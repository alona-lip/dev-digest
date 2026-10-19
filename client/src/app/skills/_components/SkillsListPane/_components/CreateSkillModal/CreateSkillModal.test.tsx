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

import { CreateSkillModal } from "./CreateSkillModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderModal = (onClose = vi.fn()) => {
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <CreateSkillModal onClose={onClose} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
  return onClose;
};

describe("CreateSkillModal", () => {
  it("has name, description, type and a markdown body with Edit / Preview", async () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Skill body"), { target: { value: "# Heading\n\nRule." } });
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
  });

  it("validates before posting, then creates a manual skill and opens it", async () => {
    create.mockImplementationOnce((_input: unknown, opts: { onSuccess: (s: { id: string; name: string }) => void }) =>
      opts.onSuccess({ id: "new1", name: "my-skill" }),
    );
    const onClose = renderModal();
    await userEvent.click(screen.getByRole("button", { name: "Create skill" }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Name is required.");

    await userEvent.type(screen.getAllByRole("textbox")[0]!, "my-skill");
    await userEvent.type(screen.getAllByRole("textbox")[1]!, "Use when X.");
    fireEvent.change(screen.getByLabelText("Skill body"), { target: { value: "Do Y." } });
    await userEvent.click(screen.getByRole("button", { name: "Create skill" }));

    expect(create.mock.calls[0]![0]).toEqual({
      name: "my-skill",
      description: "Use when X.",
      type: "custom",
      body: "Do Y.",
      source: "manual",
    });
    expect(onClose).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/skills/new1");
  });
});
