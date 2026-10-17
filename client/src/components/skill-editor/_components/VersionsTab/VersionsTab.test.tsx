import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillVersion } from "@devdigest/shared";
import messages from "@messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

const restore = vi.fn();
const VERSIONS: SkillVersion[] = [
  { version: 2, body: "line1\nnew", message: "Tightened scope", created_at: "2026-05-30T00:00:00Z", current: true },
  { version: 1, body: "line1\nold", message: "Initial version", created_at: "2026-03-02T00:00:00Z", current: false },
];
vi.mock("@/lib/hooks/skills", () => ({
  useSkillVersions: () => ({ data: VERSIONS, isLoading: false, isError: false, refetch: vi.fn() }),
  useRestoreSkillVersion: () => ({ mutate: restore, isPending: false }),
}));

import { VersionsTab } from "./VersionsTab";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restore.mockClear();
});

const SKILL = { id: "s1", body: "line1\nnew", version: 2 } as Skill;
const renderTab = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <VersionsTab skill={SKILL} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );

describe("VersionsTab", () => {
  it("marks the current version and offers Diff/Restore only on older ones", () => {
    renderTab();
    expect(screen.getByText("2 versions")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Diff/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Restore/ })).toHaveLength(1);
  });

  it("Diff expands the changes against the current body", async () => {
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: /Diff/ }));
    const diff = screen.getByLabelText("Changes from v1 to the current body");
    expect(diff).toHaveTextContent("- old");
    expect(diff).toHaveTextContent("+ new");
  });

  it("Restore asks for confirmation, then restores that version", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: /Restore/ }));
    expect(confirm).toHaveBeenCalled();
    expect(restore.mock.calls[0]![0]).toEqual({ id: "s1", version: 1 });
  });

  it("declining the confirmation restores nothing", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: /Restore/ }));
    expect(restore).not.toHaveBeenCalled();
  });
});
