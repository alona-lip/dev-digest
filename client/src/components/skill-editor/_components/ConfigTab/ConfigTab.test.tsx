import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "@messages/en/skills.json";
import common from "@messages/en/common.json";
import { ToastProvider } from "@/lib/toast";

const update = vi.fn();
const del = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: update, isPending: false }),
  useDeleteSkill: () => ({ mutate: del, isPending: false }),
}));

import { ConfigTab } from "./ConfigTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SKILL: Skill = {
  id: "s1",
  name: "pr-quality-rubric",
  description: "Rubric for PR quality.",
  type: "rubric",
  source: "manual",
  body: "# PR Quality Rubric\n\nBe precise.",
  enabled: true,
  version: 5,
  tokens: 166,
  created_at: "2026-03-02T00:00:00Z",
};

const renderTab = (skill: Skill) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages, common }}>
      <ToastProvider>
        <ConfigTab skill={skill} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );

describe("ConfigTab", () => {
  it("tells the author to write the description as a directive", () => {
    renderTab(SKILL);
    expect(screen.getByText(/Write it as a directive/)).toBeInTheDocument();
  });

  it("shows the saved token count and no 'unsaved' / change-note until the body is edited", async () => {
    renderTab(SKILL);
    expect(screen.getByTestId("body-tokens")).toHaveTextContent("166 tokens");
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();
    expect(screen.queryByText("What changed?")).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Skill body"), " More.");
    expect(screen.getByText("unsaved")).toBeInTheDocument();
    expect(screen.getByTestId("body-tokens")).toHaveTextContent("~");
    expect(screen.getByText("What changed?")).toBeInTheDocument();
  });

  it("saves only when something changed, sending the change note with a new body", async () => {
    renderTab(SKILL);
    const save = screen.getByRole("button", { name: /Save skill/ });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Skill body"), { target: { value: "# New body" } });
    await userEvent.type(screen.getByPlaceholderText("e.g. Tightened scope rule"), "Tightened");
    await userEvent.click(save);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0]).toEqual({
      id: "s1",
      patch: {
        name: "pr-quality-rubric",
        description: "Rubric for PR quality.",
        type: "rubric",
        body: "# New body",
        change_note: "Tightened",
      },
    });
  });

  it("the Enabled switch writes immediately", async () => {
    renderTab(SKILL);
    await userEvent.click(screen.getByRole("switch"));
    expect(update).toHaveBeenCalledWith({ id: "s1", patch: { enabled: false } });
  });

  it("Delete opens a confirmation modal instead of deleting at once", async () => {
    renderTab(SKILL);
    await userEvent.click(screen.getByRole("button", { name: "Delete skill" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText('Delete skill "pr-quality-rubric"?')).toBeInTheDocument();
    expect(del).not.toHaveBeenCalled();

    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete skill" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(del).toHaveBeenCalledWith("s1", expect.anything());
  });
});
