import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useBlastRadius, useBlastResync } from "./blast";
import { RESYNC_POLL_TIMEOUT_MS } from "./blast.constants";

/**
 * Resync completion is detected by watching `/index-state` move. Real QueryClient and real hooks;
 * only `fetch` is faked and time is driven by fake timers. The assertion is on how many times the
 * blast map is fetched: once on mount, and exactly once more when the resync is considered done.
 */
const S0 = { lastIndexedSha: "aaa", updatedAt: "2026-01-01T00:00:00Z" };
const S1 = { lastIndexedSha: "aaa", updatedAt: "2026-01-01T00:05:00Z" };

let indexState: { status: number; body: unknown };
let postStatus: number;
let fetchMock: ReturnType<typeof vi.fn>;

const blastGets = () => fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/pulls/pr1/blast")).length;
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(
    () => {
      useBlastRadius("pr1");
      return useBlastResync("repo1", "pr1");
    },
    { wrapper },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  indexState = { status: 200, body: S0 };
  postStatus = 202;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return new Response(JSON.stringify({ status: "queued" }), { status: postStatus });
    if (String(url).endsWith("/index-state")) {
      return new Response(JSON.stringify(indexState.body), { status: indexState.status });
    }
    return new Response(JSON.stringify({ downstream: [] }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useBlastResync", () => {
  it("refetches the blast map exactly once when the index state advances", async () => {
    const { result } = setup();
    await advance(10);
    expect(blastGets()).toBe(1);

    act(() => result.current.resync());
    expect(result.current.resyncing).toBe(true);
    await advance(10);
    expect(blastGets()).toBe(1);

    indexState = { status: 200, body: S1 };
    await advance(3_200);
    expect(result.current.resyncing).toBe(false);
    expect(blastGets()).toBe(2);
    await advance(10_000);
    expect(blastGets()).toBe(2);
  });

  it("keeps polling while the index is unchanged and falls back to a refetch on timeout", async () => {
    const { result } = setup();
    await advance(10);
    act(() => result.current.resync());

    await advance(RESYNC_POLL_TIMEOUT_MS - 5_000);
    expect(result.current.resyncing).toBe(true);
    expect(blastGets()).toBe(1);

    await advance(6_000);
    expect(result.current.resyncing).toBe(false);
    expect(blastGets()).toBe(2);
  });

  it("does not finish early when clicked before the index state has loaded", async () => {
    indexState = { status: 500, body: { error: "boom" } };
    const { result } = setup();
    await advance(10);

    act(() => result.current.resync());
    // The first successful poll only establishes the baseline.
    indexState = { status: 200, body: S0 };
    await advance(3_200);
    expect(result.current.resyncing).toBe(true);
    expect(blastGets()).toBe(1);

    // A later change completes it.
    indexState = { status: 200, body: S1 };
    await advance(3_200);
    expect(result.current.resyncing).toBe(false);
    expect(blastGets()).toBe(2);
  });

  it("exposes a failed resync request and stops resyncing", async () => {
    postStatus = 500;
    const { result } = setup();
    await advance(10);
    act(() => result.current.resync());
    await advance(50);
    expect(result.current.resyncError).toBeTruthy();
    expect(result.current.resyncing).toBe(false);
  });
});
