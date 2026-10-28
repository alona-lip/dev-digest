import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import contextMessages from "@messages/en/context.json";

let repoId: string | null = null;
vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ repoId }) }));
vi.mock("@/components/context-docs-picker", () => ({
  ContextDocsPicker: (p: { kind: string; ownerId: string; repoId: string | null }) => (
    <div data-testid="picker">{`${p.kind}|${p.ownerId}|${p.repoId}`}</div>
  ),
}));

import { ContextTab } from "./ContextTab";

afterEach(cleanup);

const renderTab = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
        <ContextTab agentId="ag1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

describe("agent ContextTab", () => {
  it("AC-21: renders the agent picker for this agent and the active repo", () => {
    repoId = "r1";
    renderTab();
    expect(screen.getByTestId("picker")).toHaveTextContent("agent|ag1|r1");
  });

  it("AC-32: passes a null repo through when none is selected", () => {
    repoId = null;
    renderTab();
    expect(screen.getByTestId("picker")).toHaveTextContent("agent|ag1|null");
  });
});
