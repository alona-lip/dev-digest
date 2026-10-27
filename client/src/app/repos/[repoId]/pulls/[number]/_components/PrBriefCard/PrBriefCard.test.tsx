/**
 * PrBriefCard — the Overview tab's verdict block, rendered with the REAL review
 * hooks and a real QueryClient; only `fetch` is faked. Checked by what the user
 * reads: the latest verdict, its score and cost, "not available yet", or an error.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FindingRecord, ReviewRecord, RunSummary } from "@devdigest/shared";
import prReview from "@messages/en/prReview.json";
import brief from "@messages/en/brief.json";
import { PrBriefCard } from "./PrBriefCard";
import { pickLatestBrief } from "./helpers";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function finding(o: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f1",
    severity: "WARNING",
    category: "bug",
    title: "Off-by-one in tier boundary",
    file: "src/pricing.ts",
    start_line: 10,
    end_line: 10,
    rationale: "",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r-new",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function review(o: Partial<ReviewRecord>): ReviewRecord {
  return {
    id: "r-new",
    pr_id: "pr-1",
    agent_id: "a1",
    run_id: "run-new",
    agent_name: "General Reviewer",
    kind: "review",
    verdict: "request_changes",
    summary: "Adds new discount tiers to the pricing module.",
    score: 76,
    model: "m",
    grounding: null,
    created_at: "2026-10-25T12:00:00.000Z",
    findings: [],
    ...o,
  };
}

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-new",
    agent_id: "a1",
    agent_name: "General Reviewer",
    provider: "openrouter",
    model: "m",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 7200,
    tokens_out: 700,
    cost_usd: 0.003,
    findings_count: 2,
    grounding: null,
    ran_at: "2026-10-25T12:00:00.000Z",
    score: 76,
    blockers: 1,
    ...o,
  };
}

type Reply = { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;

/** Fake API: GET /pulls/pr-1/reviews and /pulls/pr-1/runs answer with the given replies. */
function stubApi({ reviews, runs = { status: 200, body: [] } }: { reviews: Reply; runs?: Reply }) {
  const fetchMock = vi.fn(async (url: string) => {
    const reply = await (String(url).endsWith("/runs") ? runs : reviews);
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview, brief }}>
        <PrBriefCard prId="pr-1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("pickLatestBrief", () => {
  it("takes the newest review with a verdict, skipping summaries, and joins its run", () => {
    const summary = review({ id: "s", kind: "summary", verdict: null, run_id: null });
    const latest = review({
      findings: [
        finding({ id: "a", severity: "CRITICAL" }),
        finding({ id: "b", severity: "CRITICAL", dismissed_at: "2026-10-25T12:30:00.000Z" }),
        finding({ id: "c" }),
      ],
    });
    const older = review({ id: "r-old", run_id: "run-old", verdict: "approve" });

    const got = pickLatestBrief([summary, latest, older], [run({ run_id: "run-old" }), run({})]);

    expect(got?.review.id).toBe("r-new");
    expect(got?.verdict).toBe("request_changes");
    expect(got?.blockers).toBe(1); // the dismissed CRITICAL does not block
    expect(got?.run?.run_id).toBe("run-new");
  });

  it("is null with no verdict review, and has no run when the run list lacks it", () => {
    expect(pickLatestBrief(undefined, undefined)).toBeNull();
    expect(pickLatestBrief([review({ verdict: null })], [])).toBeNull();
    expect(pickLatestBrief([review({})], [])?.run).toBeNull();
  });
});

describe("PrBriefCard", () => {
  it("shows the latest verdict, summary, score and what the run cost", async () => {
    stubApi({
      reviews: { status: 200, body: [review({ findings: [finding({}), finding({ id: "f2" })] })] },
      runs: { status: 200, body: [run({})] },
    });
    renderCard();

    expect(screen.getByText("PR Brief")).toBeInTheDocument();
    expect(await screen.findByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("Adds new discount tiers to the pricing module.")).toBeInTheDocument();
    expect(screen.getByText("76")).toBeInTheDocument();
    expect(screen.getByText(/2 findings/)).toBeInTheDocument();
    expect(await screen.findByText("7,900 tok · $0.003")).toBeInTheDocument();
  });

  it("says the brief is not available before any review", async () => {
    stubApi({ reviews: { status: 200, body: [] } });
    renderCard();
    expect(await screen.findByText("Brief not available yet.")).toBeInTheDocument();
    expect(screen.getByText("Run a review or open the PR to compute it.")).toBeInTheDocument();
    expect(screen.queryByText("PR SCORE")).not.toBeInTheDocument();
  });

  it("shows nothing final while the reviews load", async () => {
    let resolve!: (r: { status: number; body: unknown }) => void;
    stubApi({ reviews: new Promise((r) => (resolve = r)) });
    renderCard();
    expect(screen.queryByText("Brief not available yet.")).not.toBeInTheDocument();
    expect(screen.queryByText("Request changes")).not.toBeInTheDocument();

    resolve({ status: 200, body: [review({})] });
    expect(await screen.findByText("Request changes")).toBeInTheDocument();
  });

  it("reports a failed reviews request as an error, not as 'not available', and Retry refetches", async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi({ reviews: { status: 500, body: { error: { code: "x", message: "boom" } } } });
    renderCard();

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the PR brief");
    expect(screen.queryByText("Brief not available yet.")).not.toBeInTheDocument();

    fetchMock.mockImplementation(async (url: string) =>
      new Response(JSON.stringify(String(url).endsWith("/runs") ? [] : [review({})]), { status: 200 }),
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Request changes")).toBeInTheDocument();
  });
});
