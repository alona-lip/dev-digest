/** PriorPrs — real hook, real QueryClient, only `fetch` is faked. */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "@messages/en/blast.json";
import type { PrHistory } from "@devdigest/shared";
import { PriorPrs } from "./PriorPrs";

const HISTORY: PrHistory = {
  history: [
    {
      pr_number: 42,
      title: "Refactor context",
      merged_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      author: "ana",
      files_overlap: ["server/ctx.ts", "server/id.ts"],
      notes: "",
    },
  ],
};

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

function renderPrior(repoFullName: string | null = "acme/app") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
        <PriorPrs prId="pr-1" repoFullName={repoFullName} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

const header = () => screen.getByRole("button", { name: /Prior PRs touching these files/ });

/** The accordion starts collapsed; wait for the data (count in the header), then open it. */
async function renderOpen(repoFullName: string | null = "acme/app") {
  const user = userEvent.setup();
  renderPrior(repoFullName);
  await user.click(header());
  return user;
}

describe("PriorPrs", () => {
  it("starts collapsed with a count, opens to GitHub links with tooltip and date, and closes", async () => {
    const user = userEvent.setup();
    stubFetch(200, HISTORY);
    renderPrior();

    // Collapsed: the count is in the header, the (hidden) body exists for aria-controls.
    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(await within(header()).findByText("1")).toBeInTheDocument();
    expect(document.getElementById(header().getAttribute("aria-controls")!)).not.toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    await user.click(header());
    expect(header()).toHaveAttribute("aria-expanded", "true");
    const link = await screen.findByRole("link", { name: /#42\s*Refactor context/ });
    expect(link).toHaveAttribute("href", "https://github.com/acme/app/pull/42");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("2 overlap")).toHaveAttribute("title", "server/ctx.ts\nserver/id.ts");
    expect(screen.getByText("3 days ago")).toBeInTheDocument();

    await user.click(header());
    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders plain text without a repo", async () => {
    stubFetch(200, HISTORY);
    await renderOpen(null);
    expect(await screen.findByText("Refactor context")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    stubFetch(200, { history: [] });
    await renderOpen();
    expect(await screen.findByText("No prior PRs overlap these files.")).toBeInTheDocument();
  });

  it("shows a quiet error line with the server's message", async () => {
    stubFetch(502, { error: { code: "x", message: "GitHub down" } });
    await renderOpen();
    expect(await screen.findByText(/Couldn't load prior PRs: .*GitHub down/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
