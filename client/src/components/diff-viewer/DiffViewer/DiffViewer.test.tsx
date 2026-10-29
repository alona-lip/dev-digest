import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@/lib/types";
import messages from "@messages/en/shell.json";
import { DiffViewer } from "./DiffViewer";

const scroll = vi.fn();

beforeEach(() => {
  scroll.mockClear();
  Element.prototype.scrollIntoView = scroll;
});
afterEach(cleanup);

const small = (path: string): PrFile =>
  ({ path, additions: 1, deletions: 0, patch: "@@ -1,1 +5,2 @@\n ctx\n+added line" }) as PrFile;
const big = (path: string): PrFile =>
  ({ path, additions: 300, deletions: 0, patch: "@@ -1,1 +40,2 @@\n ctx\n+big added" }) as PrFile;

function renderViewer(files: PrFile[], target?: { file: string; line: number | null }) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: messages }}>
      <DiffViewer files={files} target={target} />
    </NextIntlClientProvider>
  );
}

describe("DiffViewer target", () => {
  it("AC-57: a collapsed (>200 lines) target file opens and is scrolled into view", () => {
    renderViewer([small("a.ts"), big("big.ts")], { file: "big.ts", line: null });
    expect(screen.getByText("big added")).toBeInTheDocument();
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("AC-58: the target line is highlighted with a visible label and the header has focus", () => {
    renderViewer([big("big.ts")], { file: "big.ts", line: 41 });
    const row = screen.getByText("big added").closest("[data-highlighted]");
    expect(row).toHaveAttribute("data-highlighted", "true");
    expect(row).toHaveAttribute("aria-current", "location");
    expect(screen.getByText("Linked line")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /big\.ts/ })).toHaveFocus();
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it("AC-61: unknown file renders normally without scroll or error", () => {
    renderViewer([small("a.ts"), big("big.ts")], { file: "nope.ts", line: 3 });
    expect(screen.getByText("added line")).toBeInTheDocument();
    expect(screen.queryByText("big added")).not.toBeInTheDocument();
    expect(scroll).not.toHaveBeenCalled();
    expect(screen.queryByText("Linked line")).not.toBeInTheDocument();
  });

  it("AC-61: known file with an unrendered line scrolls to the file, no highlight", () => {
    renderViewer([small("a.ts")], { file: "a.ts", line: 999 });
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Linked line")).not.toBeInTheDocument();
    expect(document.querySelector("[data-highlighted]")).toBeNull();
  });

  it("without a target the open/closed behaviour is unchanged and the header toggles by keyboard", async () => {
    const user = userEvent.setup();
    renderViewer([small("a.ts"), big("big.ts")]);
    expect(screen.getByText("added line")).toBeInTheDocument();
    expect(screen.queryByText("big added")).not.toBeInTheDocument();
    expect(scroll).not.toHaveBeenCalled();
    const header = screen.getByRole("button", { name: /big\.ts/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    header.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("big added")).toBeInTheDocument();
    await user.keyboard(" ");
    expect(screen.queryByText("big added")).not.toBeInTheDocument();
  });
});
