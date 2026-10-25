/**
 * BlastRadiusCard — rendered with the REAL blast hooks and a real QueryClient; only
 * `fetch` is faked, so Resync is checked by the request the user's click sends.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "@messages/en/blast.json";
import type { PrBlastRadius } from "@devdigest/shared";
import { BlastRadiusCard } from "./BlastRadiusCard";

const HEAD = "abc123";
const BLAST: PrBlastRadius = {
  pr_id: "pr-1",
  changed_symbols: [
    { name: "getContext", file: "server/ctx.ts", kind: "function" },
    { name: "parseId", file: "server/id.ts", kind: "function" },
  ],
  downstream: [
    {
      symbol: "getContext",
      callers: [
        { name: "settingsRoutes", file: "server/settings/routes.ts", line: 31 },
        { name: "reposRoutes", file: "server/repos/routes.ts", line: 40 },
      ],
      endpoints_affected: ["GET /x", "PUT /x"],
      crons_affected: ["job:poll"],
    },
    {
      symbol: "parseId",
      callers: [{ name: "agentsRoutes", file: "server/agents/routes.ts", line: 7 }],
      endpoints_affected: ["GET /x"],
      crons_affected: [],
    },
  ],
  summary: "",
  degraded: false,
  reason: null,
};

function stubApi(get: { status: number; body: unknown }) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return new Response(JSON.stringify({ status: "queued" }), { status: 202 });
    if (String(url).endsWith("/index-state")) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(get.body), { status: get.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
        <BlastRadiusCard prId="pr-1" repoId="repo-1" repoFullName="acme/app" headSha={HEAD} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("BlastRadiusCard", () => {
  it("summarises, lists callers as GitHub links, separates chips, and toggles groups and views", async () => {
    const user = userEvent.setup();
    stubApi({ status: 200, body: BLAST });
    renderCard();

    // Summary: 2 symbols, 3 callers, 2 unique endpoints, 1 cron.
    expect(await screen.findByText("symbols")).toBeInTheDocument();
    const terms = screen.getAllByRole("term").map((el) => el.textContent);
    const values = screen.getAllByRole("definition").map((el) => el.textContent);
    expect(terms).toEqual(["symbols", "callers", "endpoints", "cron/jobs"]);
    expect(values).toEqual(["2", "3", "2", "1"]);

    // Groups in server order; first expanded, second collapsed.
    const headers = screen.getAllByRole("button", { name: /^(Collapse|Expand) / });
    expect(headers.map((h) => h.textContent)).toEqual([
      expect.stringContaining("getContext"),
      expect.stringContaining("parseId"),
    ]);
    expect(headers[0]).toHaveAttribute("aria-expanded", "true");
    expect(headers[1]).toHaveAttribute("aria-expanded", "false");

    const link = screen.getByRole("link", { name: "server/settings/routes.ts:31" });
    expect(link.getAttribute("href")).toMatch(new RegExp(`/blob/${HEAD}/server/settings/routes\\.ts#L31$`));
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("settingsRoutes")).toBeInTheDocument();
    expect(screen.getByText("GET /x")).toBeInTheDocument();
    expect(screen.getByText("job:poll")).toBeInTheDocument();

    await user.click(headers[1]!);
    expect(headers[1]).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "server/agents/routes.ts:7" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "graph" }));
    expect(screen.getByRole("img", { name: "Blast radius graph" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "graph" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says so when nothing is downstream", async () => {
    stubApi({ status: 200, body: { ...BLAST, downstream: [] } });
    renderCard();
    expect(await screen.findByText("2 changed symbol(s), no downstream callers found.")).toBeInTheDocument();
  });

  it("flags a partial index with a working Resync", async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi({ status: 200, body: { ...BLAST, degraded: true, reason: "index_partial" } });
    renderCard();
    expect(await screen.findByText("Index incomplete: the index is only partial")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resync index" }));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/repos\/repo-1\/resync$/),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("offers no Resync when the flag is off", async () => {
    stubApi({ status: 200, body: { ...BLAST, degraded: true, reason: "flag_off" } });
    renderCard();
    expect(await screen.findByText(/Index incomplete: repo intelligence is turned off/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Resync/ })).not.toBeInTheDocument();
  });

  it("shows an error state when the request fails", async () => {
    stubApi({ status: 500, body: { error: { code: "x", message: "boom" } } });
    renderCard();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the blast radius");
  });
});
