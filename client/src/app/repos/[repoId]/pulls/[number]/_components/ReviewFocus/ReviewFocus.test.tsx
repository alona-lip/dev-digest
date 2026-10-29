import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@messages/en/brief.json";
import type { ReviewFocusItem } from "@devdigest/shared";
import { ReviewFocus } from "./ReviewFocus";

function renderFocus(items: ReviewFocusItem[], props: { renderedFiles?: string[]; onOpenFile?: (f: string, l: number | null) => void } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <ReviewFocus items={items} {...props} />
    </NextIntlClientProvider>,
  );
}

const ITEMS: ReviewFocusItem[] = [
  { file: "src/a.ts", line: 12, reason: "first" },
  { file: "src/b.ts", line: 3, reason: "second" },
  { file: "src/c.ts", line: 7, reason: "third" },
  { file: "src/d.ts", line: 1, reason: "fourth" },
];

describe("ReviewFocus", () => {
  it("AC-47: shows title, count badge and items in stored order", () => {
    renderFocus(ITEMS);
    expect(screen.getByText("Review focus — read these first")).toBeInTheDocument();
    expect(screen.getByLabelText("4 files to read first")).toHaveTextContent("4");
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Open src/a.ts:12",
      "Open src/b.ts:3",
      "Open src/c.ts:7",
      "Open src/d.ts:1",
    ]);
  });

  it("AC-48: empty focus shows noFocus", () => {
    renderFocus([]);
    expect(screen.getByText("No specific files to prioritise.")).toBeInTheDocument();
  });

  it("AC-68: a 120-char path and 300-char reason are shown in full and wrap", () => {
    const file = `${"d/".repeat(58)}x.ts`;
    const reason = "r".repeat(300);
    renderFocus([{ file, line: 4, reason }]);
    const loc = screen.getByText(`${file}:4`);
    const rsn = screen.getByText(reason);
    for (const el of [loc, rsn]) {
      expect(el.style.textOverflow).not.toBe("ellipsis");
      expect(el.style.whiteSpace).toBe("normal");
      expect(el.style.overflowWrap).toBe("anywhere");
    }
  });

  it("AC-59/AC-60: an item in the diff opens it; one outside shows fileNotInDiff and does not navigate", async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    renderFocus(ITEMS, { renderedFiles: ["src/a.ts"], onOpenFile });
    await user.click(screen.getByRole("button", { name: "Open src/a.ts:12" }));
    expect(onOpenFile).toHaveBeenCalledWith("src/a.ts", 12);
    onOpenFile.mockClear();
    await user.click(screen.getByRole("button", { name: "Open src/b.ts:3" }));
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(screen.getByText("File not in this PR's diff")).toBeInTheDocument();
  });
});
