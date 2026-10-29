/**
 * PrBriefCard — the Overview tab's verdict block, rendered with the REAL review
 * hooks and a real QueryClient; only `fetch` is faked. Checked by what the user
 * reads: the latest verdict, its score and cost, "not available yet", or an error.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
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
const NONE: Reply = { status: 200, body: { status: "none" } };
const INTENT: Reply = { status: 200, body: { intent: "i", in_scope: [], out_of_scope: [] } };

function readyBrief(summary: string, o: { stale?: boolean; missing?: { input: string; reason: string }[] } = {}) {
  return {
    status: "ready",
    stale: o.stale ?? false,
    current_head_sha: "sha2",
    brief: {
      pr_id: "pr-1",
      head_sha: "sha1",
      generated_at: "2026-10-25T12:00:00.000Z",
      model: "m",
      summary,
      risks: [],
      review_focus: [],
      missing_inputs: o.missing ?? [],
      trimmed_inputs: [],
      dropped: { risks: 0, review_focus: 0 },
      input_tokens: 10,
      cost_usd: null,
    },
  };
}

/** Fake API routing /brief (GET + POST), /intent, /runs and /reviews separately; logs every call. */
function stubApi({
  reviews = { status: 200, body: [] },
  runs = { status: 200, body: [] },
  brief = NONE,
  intent = INTENT,
  post,
}: { reviews?: Reply; runs?: Reply; brief?: Reply; intent?: Reply; post?: () => Reply } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const reply = await (u.endsWith("/brief")
      ? init?.method === "POST"
        ? (post?.() ?? NONE)
        : brief
      : u.endsWith("/intent")
        ? intent
        : u.endsWith("/runs")
          ? runs
          : reviews);
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const calls = (m: ReturnType<typeof stubApi>, method: string, suffix: string) =>
  m.mock.calls.filter(([u, i]) => String(u).endsWith(suffix) && (i?.method ?? "GET") === method).length;

function renderCard(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
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

  it("AC-38: with no brief and no review, offers a Generate brief button", async () => {
    stubApi();
    renderCard();
    expect(await screen.findByRole("button", { name: "Generate brief" })).toBeEnabled();
    expect(screen.getByText("No brief yet")).toBeInTheDocument();
    expect(screen.queryByText("PR SCORE")).not.toBeInTheDocument();
  });

  it("shows nothing final while the reviews load", async () => {
    let resolve!: (r: { status: number; body: unknown }) => void;
    stubApi({ reviews: new Promise((r) => (resolve = r)) });
    renderCard();
    expect(screen.queryByRole("button", { name: "Generate brief" })).not.toBeInTheDocument();
    expect(screen.queryByText("Request changes")).not.toBeInTheDocument();

    resolve({ status: 200, body: [review({})] });
    expect(await screen.findByText("Request changes")).toBeInTheDocument();
  });

  it("reports a failed reviews request as an error, not as 'not available', and Retry refetches", async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi({ reviews: { status: 500, body: { error: { code: "x", message: "boom" } } } });
    renderCard();

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the PR brief");
    expect(screen.queryByRole("button", { name: "Generate brief" })).not.toBeInTheDocument();

    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      const body = u.endsWith("/brief") ? { status: "none" } : u.endsWith("/reviews") ? [review({})] : [];
      return new Response(JSON.stringify(body), { status: 200 });
    });
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Request changes")).toBeInTheDocument();
  });
});

describe("PrBriefCard brief states", () => {
  const ok = (body: unknown): Reply => ({ status: 200, body });

  it("AC-50: mount issues GET /brief and never a POST; AC-55 brief only shows the brief summary as a paragraph", async () => {
    const f = stubApi({ brief: ok(readyBrief("Brief says X.")) });
    renderCard();
    expect(await screen.findByText("Brief says X.")).toBeInTheDocument();
    expect(calls(f, "GET", "/brief")).toBe(1);
    expect(calls(f, "POST", "/brief")).toBe(0);
    expect(screen.queryByText("PR SCORE")).not.toBeInTheDocument();
  });

  it("AC-55/AC-66: review + brief puts the brief summary and refresh in the banner; review only keeps the review summary", async () => {
    stubApi({ reviews: ok([review({})]), brief: ok(readyBrief("Brief says X.")) });
    const { unmount } = renderCard();
    expect(await screen.findByText("Brief says X.")).toBeInTheDocument();
    expect(screen.queryByText("Adds new discount tiers to the pricing module.")).not.toBeInTheDocument();
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate the PR brief" })).toBeInTheDocument();
    unmount();
    cleanup();

    stubApi({ reviews: ok([review({})]) });
    renderCard();
    expect(await screen.findByText("Adds new discount tiers to the pricing module.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate brief" })).toBeInTheDocument();
  });

  it("AC-66: refresh sits top-right inside the banner (with Outdated next to it); without a review it sits top-right of the block", async () => {
    stubApi({ reviews: ok([review({})]), brief: ok(readyBrief("Brief says X.", { stale: true })) });
    const { unmount } = renderCard();
    const slot = await screen.findByTestId("verdict-banner-actions");
    const refresh = within(slot).getByRole("button", { name: "Regenerate the PR brief" });
    expect(within(slot).getByText(/^Outdated/)).toBeInTheDocument();
    expect(refresh.parentElement).toBe(screen.getByText(/^Outdated/).parentElement); // badge next to the button
    expect(slot).toHaveStyle({ display: "flex", flexDirection: "column", alignItems: "flex-end" }); // right edge
    expect(slot.parentElement).toHaveStyle({ alignItems: "flex-start" }); // top edge of the banner row
    expect(screen.queryByTestId("brief-block-actions")).not.toBeInTheDocument();
    unmount();
    cleanup();

    stubApi({ brief: ok(readyBrief("Brief only.", { stale: true })) });
    renderCard();
    const top = await screen.findByTestId("brief-block-actions");
    expect(within(top).getByRole("button", { name: "Regenerate the PR brief" })).toBeInTheDocument();
    expect(within(top).getByText(/^Outdated/)).toBeInTheDocument();
    expect(top).toHaveStyle({ display: "flex", justifyContent: "flex-end" });
    // first child of the block, above the summary
    expect(top.parentElement?.firstElementChild).toBe(top);
    expect(screen.queryByTestId("verdict-banner-actions")).not.toBeInTheDocument();
  });

  it("AC-66: with status none, Generate brief sits inside the centred empty state", async () => {
    stubApi();
    renderCard();
    const empty = await screen.findByTestId("brief-empty-state");
    expect(within(empty).getByRole("button", { name: "Generate brief" })).toBeInTheDocument();
    expect(empty).toHaveStyle({ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" });
    expect(screen.queryByRole("button", { name: "Regenerate the PR brief" })).not.toBeInTheDocument();
  });

  it("AC-39/AC-40/AC-52: double click sends one POST, a skeleton shows meanwhile, then the new summary replaces the old", async () => {
    const user = userEvent.setup();
    let release!: (r: { status: number; body: unknown }) => void;
    const f = stubApi({
      brief: ok(readyBrief("Old summary.")),
      post: () => new Promise((r) => (release = r)),
    });
    renderCard();
    const btn = await screen.findByRole("button", { name: "Regenerate the PR brief" });
    await user.dblClick(btn);
    expect(calls(f, "POST", "/brief")).toBe(1);
    expect(screen.getByRole("button", { name: "Regenerate the PR brief" })).toBeDisabled();
    expect(screen.queryByText("Old summary.")).not.toBeInTheDocument();
    expect(document.querySelector("section")).toHaveAttribute("aria-busy", "true");

    release({ status: 200, body: readyBrief("New summary.") });
    expect(await screen.findByText("New summary.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate the PR brief" })).toBeEnabled();
  });

  it("AC-54: a failed POST shows the server message, keeps the previous summary and re-enables the button", async () => {
    const user = userEvent.setup();
    stubApi({
      brief: ok(readyBrief("Old summary.")),
      post: () => ({ status: 502, body: { error: { code: "llm_failed", message: "Model unreachable" } } }),
    });
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Regenerate the PR brief" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Model unreachable");
    expect(screen.getByText("Old summary.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate the PR brief" })).toBeEnabled();
  });

  it("AC-53: a failed GET /brief is an error with Retry that refetches, and no Generate button", async () => {
    const user = userEvent.setup();
    const f = stubApi({ brief: { status: 500, body: { error: { code: "x", message: "boom" } } } });
    renderCard();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the PR brief");
    expect(screen.queryByRole("button", { name: "Generate brief" })).not.toBeInTheDocument();
    expect(calls(f, "GET", "/brief")).toBe(1);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls(f, "GET", "/brief")).toBe(2));
  });

  it("AC-53: a failed refetch with a cached brief keeps the summary visible instead of the error state", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    stubApi({ brief: ok(readyBrief("Cached summary.")) });
    const { unmount } = renderCard(qc);
    await screen.findByText("Cached summary.");
    unmount();
    cleanup();

    const f = stubApi({ brief: { status: 500, body: { error: { code: "x", message: "boom" } } } });
    renderCard(qc);
    await waitFor(() => expect(calls(f, "GET", "/brief")).toBe(1));
    await waitFor(() => expect(qc.isFetching()).toBe(0)); // the failed refetch has settled
    expect(screen.getByText("Cached summary.")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load the PR brief")).not.toBeInTheDocument();
  });

  it("AC-51: a stale brief carries an Outdated badge; a fresh one does not", async () => {
    stubApi({ brief: ok(readyBrief("S.", { stale: true })) });
    const { unmount } = renderCard();
    expect(await screen.findByText(/Outdated/)).toBeInTheDocument();
    unmount();
    cleanup();
    stubApi({ brief: ok(readyBrief("S.")) });
    renderCard();
    await screen.findByText("S.");
    expect(screen.queryByText(/Outdated/)).not.toBeInTheDocument();
  });

  it("AC-42/AC-56: lists the inputs the brief was generated without, with labels from messages", async () => {
    stubApi({
      brief: ok(
        readyBrief("S.", {
          missing: [
            { input: "intent", reason: "not_computed" },
            { input: "blast", reason: "index_failed" },
          ],
        }),
      ),
    });
    renderCard();
    expect(
      await screen.findByText("Generated without: Intent — not computed yet; Blast radius — index failed"),
    ).toBeInTheDocument();
  });

  it("AC-65: shows the intent-pending hint while the intent loads, keeps Generate enabled, then drops the hint", async () => {
    let release!: (r: { status: number; body: unknown }) => void;
    stubApi({ intent: new Promise((r) => (release = r)) });
    renderCard();
    expect(await screen.findByText(/Intent is still being computed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate brief" })).toBeEnabled();
    release({ status: 200, body: { intent: "i", in_scope: [], out_of_scope: [] } });
    await waitFor(() => expect(screen.queryByText(/Intent is still being computed/)).not.toBeInTheDocument());
  });
});
