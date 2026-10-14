import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCancelRun, useDeleteRun, useFindingAction, useRunReview } from "./reviews";

/**
 * Cache invalidation is the data layer's contract with the UI: after a run
 * starts, is cancelled or deleted, every list that shows it must refetch —
 * otherwise the screen keeps stale "running"/history until the next poll.
 * The network is stubbed; the assertion is on which query keys go stale.
 */
function setup() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: true, runs: [], reviews: [] }), { status: 200 })),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const invalidatedKeys = () => invalidate.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey);
  return { wrapper, invalidatedKeys };
}

const PR_RUN_KEYS = [
  ["pr-active-runs", "pr1"],
  ["pr-runs", "pr1"],
  ["reviews", "pr1"],
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reviews data hooks — invalidation", () => {
  it("starting a review refreshes in-flight runs, run history and reviews", async () => {
    const { wrapper, invalidatedKeys } = setup();
    const { result } = renderHook(() => useRunReview(), { wrapper });
    await result.current.mutateAsync({ prId: "pr1", agentIds: ["a1"] });
    expect(invalidatedKeys()).toEqual(expect.arrayContaining(PR_RUN_KEYS));
  });

  it("cancelling a run refreshes the PR's run lists right away", async () => {
    const { wrapper, invalidatedKeys } = setup();
    const { result } = renderHook(() => useCancelRun("pr1"), { wrapper });
    await result.current.mutateAsync("run1");
    expect(invalidatedKeys()).toEqual(expect.arrayContaining(PR_RUN_KEYS));
  });

  it("deleting a run also drops it from the in-flight list", async () => {
    const { wrapper, invalidatedKeys } = setup();
    const { result } = renderHook(() => useDeleteRun("pr1"), { wrapper });
    await result.current.mutateAsync("run1");
    expect(invalidatedKeys()).toEqual(expect.arrayContaining(PR_RUN_KEYS));
  });

  it("a finding action without a prId refreshes every cached review list", async () => {
    const { wrapper, invalidatedKeys } = setup();
    const { result } = renderHook(() => useFindingAction(), { wrapper });
    await result.current.mutateAsync({ findingId: "f1", action: "accept" });
    expect(invalidatedKeys()).toEqual([["reviews"]]);
  });
});
