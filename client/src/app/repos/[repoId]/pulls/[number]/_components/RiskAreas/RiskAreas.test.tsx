import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { SEV } from "@devdigest/ui";
import messages from "@messages/en/brief.json";
import type { Risk, RiskKind } from "@devdigest/shared";
import { RiskAreas } from "./RiskAreas";
import { KIND_ICON } from "./constants";

const risk = (over: Partial<Risk> = {}): Risk => ({
  kind: "security",
  title: "Rate limit bypass",
  explanation: "The limiter is skipped for proxied requests.",
  severity: "high",
  file_refs: ["src/a.ts:12-18", "src/b.ts:3"],
  ...over,
});

function renderRisks(risks: Risk[], props: { renderedFiles?: string[]; onOpenFile?: (f: string, l: number | null) => void } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <RiskAreas risks={risks} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("RiskAreas", () => {
  it("AC-64: one risk per kind renders the mapped icon", () => {
    const kinds = Object.keys(KIND_ICON) as RiskKind[];
    renderRisks(kinds.map((kind) => risk({ kind, title: `t-${kind}` })));
    const icons = screen.getAllByRole("img");
    expect(icons.map((el) => el.getAttribute("data-kind")).sort()).toEqual([...kinds].sort());
    expect(new Set(Object.values(KIND_ICON)).size).toBe(kinds.length);
    expect(KIND_ICON.security).toBe("Shield");
    expect(KIND_ICON.performance).toBe("Zap");
  });

  it("AC-67: high vs low of the same kind differ only in colour, from SEV", () => {
    renderRisks([
      risk({ title: "hi", severity: "high" }),
      risk({ title: "mid", severity: "medium" }),
      risk({ title: "lo", severity: "low" }),
    ]);
    const colors = screen.getAllByRole("img").map((el) => (el as HTMLElement).style.color);
    expect(colors).toEqual([SEV.CRITICAL.c, SEV.WARNING.c, SEV.INFO.c]);
    const kinds = new Set(screen.getAllByRole("img").map((el) => el.getAttribute("data-kind")));
    expect(kinds.size).toBe(1);
  });

  it("AC-43: rows are ordered high, medium, low with model order kept; AC-44: severity is in the accessible name", () => {
    renderRisks([
      risk({ title: "low-1", severity: "low" }),
      risk({ title: "high-1", severity: "high" }),
      risk({ title: "mid-1", severity: "medium" }),
      risk({ title: "high-2", severity: "high" }),
    ]);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "High risk: high-1",
      "High risk: high-2",
      "Medium risk: mid-1",
      "Low risk: low-1",
    ]);
    expect(screen.getByRole("listitem", { name: /Medium risk/ })).toBeInTheDocument();
    expect(within(rows[0]!).getByText("src/a.ts:12-18")).toBeInTheDocument();
  });

  it("AC-45: rows start collapsed and the chevron toggles aria-expanded and the details", async () => {
    const user = userEvent.setup();
    renderRisks([risk()]);
    const chevron = screen.getByRole("button", { name: "Show details" });
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/limiter is skipped/)).not.toBeInTheDocument();
    await user.click(chevron);
    expect(screen.getByRole("button", { name: "Hide details" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/limiter is skipped/)).toBeInTheDocument();
    expect(screen.getByText("src/b.ts:3")).toBeInTheDocument();
  });

  it("AC-46: no risks shows the noRisks message", () => {
    renderRisks([]);
    expect(screen.getByText("No notable risks flagged.")).toBeInTheDocument();
  });

  it("AC-68: a 120-char path is shown in full without ellipsis", () => {
    const path = `${"d/".repeat(58)}x.ts`;
    renderRisks([risk({ file_refs: [`${path}:5`] })]);
    const el = screen.getByText(`${path}:5`);
    expect(el.style.textOverflow).not.toBe("ellipsis");
    expect(el.style.whiteSpace).toBe("normal");
  });

  it("AC-59: a ref in the diff opens it at its first line; AC-60: a ref outside shows fileNotInDiff and does not navigate", async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    renderRisks([risk({ file_refs: ["src/a.ts:12-18"] }), risk({ title: "other", severity: "low", file_refs: ["lib/caller.ts:9"] })], {
      renderedFiles: ["src/a.ts"],
      onOpenFile,
    });
    await user.click(screen.getByRole("button", { name: "src/a.ts:12-18" }));
    expect(onOpenFile).toHaveBeenCalledWith("src/a.ts", 12);
    onOpenFile.mockClear();
    await user.click(screen.getByRole("button", { name: "lib/caller.ts:9" }));
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(screen.getByText("File not in this PR's diff")).toBeInTheDocument();
  });
});
