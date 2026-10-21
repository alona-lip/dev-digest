import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConventionCandidate } from "@devdigest/shared";
import { useBulkConventionStatus, useExtractConventions, useUpdateConvention } from "./conventions";
import { useCreateConventionSkill } from "./skills";

function setup(body: unknown = {}, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const keys = () => invalidate.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey);
  return { qc, wrapper, keys, fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

const c = (id: string, status: ConventionCandidate["status"]) => ({ id, status, rule: `r${id}` }) as ConventionCandidate;
const LIST_KEY = ["conventions", "r1"];

describe("conventions hooks", () => {
  it("a scan seeds the candidate list from its response", async () => {
    const candidates = [c("1", "ACCEPTED")];
    const { wrapper, qc, fetchMock } = setup({ candidates, stats: {}, model: "m", cost_usd: null });
    const { result } = renderHook(() => useExtractConventions("r1"), { wrapper });
    await result.current.mutateAsync();
    expect(qc.getQueryData(LIST_KEY)).toEqual(candidates);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toMatch(/\/repos\/r1\/conventions\/extract$/);
  });

  it("accept shows at once and refetches the list after", async () => {
    const { wrapper, qc, keys } = setup(c("1", "ACCEPTED"));
    qc.setQueryData(LIST_KEY, [c("1", "PENDING"), c("2", "PENDING")]);
    const { result } = renderHook(() => useUpdateConvention("r1"), { wrapper });
    const pending = result.current.mutateAsync({ id: "1", patch: { status: "ACCEPTED" } });
    await vi.waitFor(() =>
      expect(qc.getQueryData<ConventionCandidate[]>(LIST_KEY)?.map((x) => x.status)).toEqual(["ACCEPTED", "PENDING"]),
    );
    await pending;
    expect(keys()).toEqual(expect.arrayContaining([LIST_KEY]));
  });

  it("a rejected candidate leaves the list at once", async () => {
    const { wrapper, qc } = setup(c("1", "REJECTED"));
    qc.setQueryData(LIST_KEY, [c("1", "PENDING"), c("2", "ACCEPTED")]);
    const { result } = renderHook(() => useUpdateConvention("r1"), { wrapper });
    const pending = result.current.mutateAsync({ id: "1", patch: { status: "REJECTED" } });
    await vi.waitFor(() =>
      expect(qc.getQueryData<ConventionCandidate[]>(LIST_KEY)?.map((x) => x.id)).toEqual(["2"]),
    );
    await pending;
  });

  it("rolls the list back when the server refuses the change", async () => {
    const { wrapper, qc } = setup({ error: { code: "not_found", message: "Convention not found" } }, 404);
    const before = [c("1", "ACCEPTED")];
    qc.setQueryData(LIST_KEY, before);
    const { result } = renderHook(() => useUpdateConvention("r1"), { wrapper });
    await expect(result.current.mutateAsync({ id: "1", patch: { status: "REJECTED" } })).rejects.toBeTruthy();
    expect(qc.getQueryData(LIST_KEY)).toEqual(before);
  });

  it("Deselect all replaces the list with the server's answer", async () => {
    const after = [c("1", "PENDING"), c("2", "PENDING")];
    const { wrapper, qc } = setup(after);
    const { result } = renderHook(() => useBulkConventionStatus("r1"), { wrapper });
    await result.current.mutateAsync({ ids: ["1", "2"], status: "PENDING" });
    expect(qc.getQueryData(LIST_KEY)).toEqual(after);
  });

  it("saving the skill refreshes the skills list, its history, agent tabs and agent tiles", async () => {
    const { wrapper, keys, fetchMock } = setup({ id: "s1", name: "repo-conventions", version: 1 });
    const { result } = renderHook(() => useCreateConventionSkill("r1"), { wrapper });
    await result.current.mutateAsync({
      name: "repo-conventions",
      description: "d",
      type: "convention",
      body: "b",
      agent_id: "a1",
    });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toMatch(/\/repos\/r1\/conventions\/skill$/);
    expect(keys()).toEqual(
      expect.arrayContaining([["skills"], ["skill-versions", "s1"], ["agent-skills"], ["agents"]]),
    );
  });
});
