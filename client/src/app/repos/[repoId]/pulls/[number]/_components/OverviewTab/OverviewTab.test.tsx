/** OverviewTab — real hooks and a QueryClient; only `fetch` is faked, routed per endpoint. */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import brief from "@messages/en/brief.json";
import blast from "@messages/en/blast.json";
import prReview from "@messages/en/prReview.json";
import type { BriefResponse } from "@devdigest/shared";
import { OverviewTab } from "./OverviewTab";

const READY: BriefResponse = {
  status: "ready",
  stale: false,
  current_head_sha: "abc",
  brief: {
    pr_id: "pr-1",
    head_sha: "abc",
    generated_at: "2026-10-01T00:00:00Z",
    model: "m",
    summary: "Adds a limiter.",
    risks: [
      { kind: "security", title: "Bypass risk", explanation: "x", severity: "high", file_refs: ["src/a.ts:1"] },
    ],
    review_focus: [{ file: "src/a.ts", line: 1, reason: "start here" }],
    missing_inputs: [],
    trimmed_inputs: [],
    dropped: { risks: 0, review_focus: 0 },
    input_tokens: 1,
    cost_usd: null,
  },
};

function stubApi(briefBody: BriefResponse, opts: { intentStatus?: number; postPending?: boolean } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/brief")) {
        if (init?.method === "POST") return new Promise<Response>(() => {});
        return new Response(JSON.stringify(briefBody), { status: 200 });
      }
      if (u.includes("/intent")) {
        return new Response(JSON.stringify({ message: "boom" }), { status: opts.intentStatus ?? 500 });
      }
      if (u.includes("/reviews") || u.includes("/runs")) return new Response("[]", { status: 200 });
      return new Response("{}", { status: 404 });
    }),
  );
}

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief, blast, prReview }}>
        <OverviewTab prId="pr-1" repoId="r" repoFullName="a/b" headSha="abc" prBody="Body text" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

afterEach(() => vi.unstubAllGlobals());

describe("OverviewTab", () => {
  it("AC-41 / AC-49: a ready brief shows Risk areas and Review focus even when Intent fails", async () => {
    stubApi(READY);
    renderTab();
    expect(await screen.findByRole("listitem", { name: "High risk: Bypass risk" })).toBeInTheDocument();
    expect(screen.getByText("Risk areas")).toBeInTheDocument();
    expect(screen.getByText("Review focus — read these first")).toBeInTheDocument();
    expect(screen.getByText("start here")).toBeInTheDocument();
    expect(screen.getByText("Body text")).toBeInTheDocument();
  });

  it("AC-38: status none renders no lists", async () => {
    stubApi({ status: "none" });
    renderTab();
    expect(await screen.findByText("Body text")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Risk areas")).not.toBeInTheDocument();
    expect(screen.queryByText("Review focus — read these first")).not.toBeInTheDocument();
  });

  it("AC-40: while generating, the lists show skeletons", async () => {
    stubApi(READY);
    const { qc } = renderTab();
    await screen.findByRole("listitem", { name: /Bypass risk/ });
    const { MutationObserver } = await import("@tanstack/react-query");
    const observer = new MutationObserver(qc, {
      mutationKey: ["brief", "generate", "pr-1"],
      mutationFn: () => new Promise(() => {}),
    });
    void observer.mutate();
    expect(await screen.findAllByTestId("brief-list-skeleton")).toHaveLength(2);
    expect(screen.queryByRole("listitem", { name: /Bypass risk/ })).not.toBeInTheDocument();
  });
});
