/**
 * IntentCard — rendered with the REAL intent hooks and a real QueryClient; only
 * the network (`fetch`) is faked. So "Recompute" is checked by what the user
 * sees (the new intent replaces the old one), which also pins that the
 * mutation writes to the same cache key the query reads.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "@messages/en/prReview.json";
import type { PrIntentRecord } from "@devdigest/shared";
import { IntentCard } from "./IntentCard";

const STORED: PrIntentRecord = {
  pr_id: "pr-1",
  intent: "Add rate limiting to the public API.",
  in_scope: ["api/limits.ts middleware", "429 responses"],
  out_of_scope: ["auth flow"],
};
const RECOMPUTED: PrIntentRecord = {
  pr_id: "pr-1",
  intent: "Rate-limit the public API and document the headers.",
  in_scope: ["api/limits.ts middleware"],
  out_of_scope: [],
};

type Reply = { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;

/** Fake API: GET /pulls/pr-1/intent and POST …/recompute answer with the given replies. */
function stubApi({ get, recompute }: { get: Reply; recompute?: Reply }) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const reply = await (init?.method === "POST" ? recompute : get);
    if (!reply) throw new Error(`unexpected request ${init?.method ?? "GET"} ${url}`);
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const apiError = (status: number, message: string) => ({ status, body: { error: { code: "x", message } } });

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <IntentCard prId="pr-1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("IntentCard", () => {
  it("shows the stored intent with both scope lists, and Recompute replaces it", async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi({ get: { status: 200, body: STORED }, recompute: { status: 200, body: RECOMPUTED } });
    renderCard();

    // The derived intent and every in/out-of-scope item are visible.
    expect(await screen.findByText(STORED.intent)).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "In scope" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["api/limits.ts middleware", "429 responses"]);
    expect(within(screen.getByRole("list", { name: "Out of scope" })).getByText("auth flow")).toBeInTheDocument();

    // Recompute: the user sees the new intent, and an emptied list says so.
    await user.click(screen.getByRole("button", { name: "Recompute" }));
    expect(await screen.findByText(RECOMPUTED.intent)).toBeInTheDocument();
    expect(screen.queryByText(STORED.intent)).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Out of scope" })).not.toBeInTheDocument();
    expect(screen.getByText("Nothing listed")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/pulls\/pr-1\/intent\/recompute$/),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("while the first derivation runs: a busy skeleton, Recompute disabled, then the intent", async () => {
    let resolveGet!: (r: { status: number; body: unknown }) => void;
    stubApi({ get: new Promise((r) => (resolveGet = r)) });
    const { container } = renderCard();

    // Loading is announced (aria-busy) and Recompute cannot start a second model call.
    expect(container.querySelector("section")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Recompute" })).toBeDisabled();
    expect(screen.queryByText(STORED.intent)).not.toBeInTheDocument();

    resolveGet({ status: 200, body: STORED });
    expect(await screen.findByText(STORED.intent)).toBeInTheDocument();
    expect(container.querySelector("section")).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("button", { name: "Recompute" })).toBeEnabled();
  });

  it("explains a failed derivation, and keeps the stored intent when a recompute fails", async () => {
    const user = userEvent.setup();
    stubApi({ get: apiError(500, "OPENROUTER_API_KEY is not configured") });
    const first = renderCard();
    // The first derivation failed: the reason is shown, there is no intent to show.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't derive the PR intent: OPENROUTER_API_KEY is not configured",
    );
    first.unmount();
    vi.unstubAllGlobals();

    stubApi({ get: { status: 200, body: STORED }, recompute: apiError(429, "Rate limit exceeded") });
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Recompute" }));
    // A failed recompute reports why, but the user keeps the intent they had.
    expect(await screen.findByRole("alert")).toHaveTextContent("Rate limit exceeded");
    expect(screen.getByText(STORED.intent)).toBeInTheDocument();
  });
});
