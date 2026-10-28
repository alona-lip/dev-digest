import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@messages/en/skills.json";

let PATHS: string[] = [];
vi.mock("@/lib/hooks/project-context", () => ({
  useAttachments: () => ({ data: { repo_id: "r1", paths: PATHS, docs: [], inherited: [] } }),
}));
vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ repoId: "r1" }) }));
vi.mock("@/components/context-docs-picker", () => ({
  ContextDocsPicker: (p: { kind: string; ownerId: string; repoId: string | null }) => (
    <div data-testid="picker">{`${p.kind}:${p.ownerId}:${p.repoId}`}</div>
  ),
}));

import { ContextTab } from "./ContextTab";

afterEach(cleanup);

const renderTab = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ContextTab skillId="s1" />
    </NextIntlClientProvider>,
  );

describe("ContextTab", () => {
  it("AC-34: shows the header with the attached count, the hint and the skill picker", () => {
    PATHS = ["specs/public-api.md", "docs/adr.md"];
    renderTab();
    expect(screen.getByRole("heading", { name: "Project context to use · 2 attached" })).toBeInTheDocument();
    expect(screen.getByText("Any agent using this skill inherits these documents.")).toBeInTheDocument();
    expect(screen.getByTestId("picker")).toHaveTextContent("skill:s1:r1");
  });

  it("AC-36: 'Serializes as' lists the heading and one line per attached path, in order", () => {
    PATHS = ["specs/public-api.md", "docs/adr.md"];
    renderTab();
    expect(screen.getByText("Serializes as")).toBeInTheDocument();
    expect(screen.getByLabelText("Serializes as").textContent).toBe(
      "## Project specifications\n- specs/public-api.md\n- docs/adr.md",
    );
  });
});
