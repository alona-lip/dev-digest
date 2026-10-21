import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/skills", () => ({
  useCreateSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useImportSkillPreview: () => ({ mutate: vi.fn(), isPending: false }),
  useImportSkillUrlPreview: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { AddSkillModal } from "./AddSkillModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderModal = (props: Partial<React.ComponentProps<typeof AddSkillModal>> = {}) => {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <AddSkillModal onClose={onClose} {...props} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
  return onClose;
};

describe("AddSkillModal", () => {
  it("is one 'Add skill' dialog with Create / From file / Import from URL tabs, on Create by default", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toHaveTextContent("Add skill");
    for (const name of ["Create", "From file", "Import from URL"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Skill body")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create skill" })).toBeInTheDocument();
    // No footer Cancel: the modal closes with ✕.
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("switches tabs, mounting only the active one", async () => {
    renderModal();
    await userEvent.click(screen.getByRole("button", { name: "From file" }));
    expect(screen.getByTestId("skill-file-input")).toBeInTheDocument();
    expect(screen.queryByLabelText("Skill body")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Import from URL" }));
    expect(screen.getByText("Skill URL")).toBeInTheDocument();
    expect(screen.queryByTestId("skill-file-input")).not.toBeInTheDocument();
  });

  it("opens on the requested tab and closes with ✕", async () => {
    const onClose = renderModal({ initialTab: "file" });
    expect(screen.getByTestId("skill-file-input")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
