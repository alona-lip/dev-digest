import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@messages/en/conventions.json";
import type { ConventionCandidate } from "@devdigest/shared";
import { ConventionCard } from "./ConventionCard";

afterEach(cleanup);

const candidate = (over: Partial<ConventionCandidate> = {}): ConventionCandidate => ({
  id: "c1",
  repo_id: "r1",
  category: "ASYNC",
  rule: "Always use async/await instead of .then() chains",
  evidence_path: "src/api/users.ts",
  evidence_start_line: 23,
  evidence_end_line: 31,
  evidence_snippet: "const user = await db.users.find(id);",
  confidence: 0.91,
  status: "ACCEPTED",
  created_at: "2026-10-19T00:00:00.000Z",
  ...over,
});

function renderCard(c: ConventionCandidate) {
  const onStatus = vi.fn();
  const onSave = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionCard candidate={c} onStatus={onStatus} onSave={onSave} />
    </NextIntlClientProvider>,
  );
  return { onStatus, onSave };
}

describe("ConventionCard", () => {
  it("shows the rule, the source file with its lines, the evidence and the confidence", () => {
    renderCard(candidate());
    expect(screen.getByRole("heading", { name: /async\/await instead of \.then\(\)/ })).toBeInTheDocument();
    expect(screen.getByText("Async")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:23-31")).toBeInTheDocument();
    expect(screen.getByText("const user = await db.users.find(id);")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
  });

  it("an accepted card offers Reject (and Accept is a no-op)", async () => {
    const { onStatus } = renderCard(candidate());
    const accepted = screen.getByRole("button", { name: "Accepted" });
    expect(accepted).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(accepted);
    expect(onStatus).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onStatus).toHaveBeenCalledWith("REJECTED");
  });

  it("a rejected card shows Rejected and can be accepted again", async () => {
    const { onStatus } = renderCard(candidate({ status: "REJECTED" }));
    expect(screen.getByRole("button", { name: "Rejected" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onStatus).toHaveBeenCalledWith("ACCEPTED");
  });

  it("Edit changes the rule and category in place", async () => {
    const { onSave } = renderCard(candidate());
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    const input = screen.getByRole("textbox", { name: "Rule" });
    await userEvent.clear(input);
    await userEvent.type(input, "  Prefer async/await  ");
    await userEvent.selectOptions(screen.getByRole("combobox"), "STYLE");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith({ rule: "Prefer async/await", category: "STYLE" });
    expect(screen.queryByRole("textbox", { name: "Rule" })).not.toBeInTheDocument();
  });

  it("refuses an empty rule and Cancel leaves the card unchanged", async () => {
    const { onSave } = renderCard(candidate());
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Rule" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The rule can't be empty.");
    expect(onSave).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: /async\/await instead/ })).toBeInTheDocument();
  });
});
