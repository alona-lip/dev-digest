import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useCreateSkill,
  useDeleteSkill,
  useRestoreSkillVersion,
  useSetAgentSkills,
  useUpdateSkill,
} from "./skills";

/** Cache contract: after a skill / binding changes, every screen that shows it refetches. */
function setup(body: unknown = {}, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const keys = () => invalidate.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey);
  return { qc, wrapper, keys, fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

const SKILL = { id: "s1", name: "x", version: 2 };

describe("skills hooks — invalidation", () => {
  it("creating a skill refreshes the list, its history and every agent's skill tab", async () => {
    const { wrapper, keys } = setup(SKILL);
    const { result } = renderHook(() => useCreateSkill(), { wrapper });
    await result.current.mutateAsync({ name: "x", description: "d", type: "custom", body: "b" });
    expect(keys()).toEqual(expect.arrayContaining([["skills"], ["skill-versions", "s1"], ["agent-skills"]]));
  });

  const EXPECTED = [["skills"], ["skill-versions", "s1"], ["agent-skills"]];

  it("updating a skill refreshes the same caches and seeds the single-skill cache", async () => {
    const { wrapper, keys, qc } = setup(SKILL);
    const { result } = renderHook(() => useUpdateSkill(), { wrapper });
    await result.current.mutateAsync({ id: "s1", patch: { enabled: false } });
    expect(keys()).toEqual(expect.arrayContaining(EXPECTED));
    expect(qc.getQueryData(["skill", "s1"])).toEqual(SKILL);
  });

  it("restoring a version does the same", async () => {
    const { wrapper, keys, qc, fetchMock } = setup(SKILL);
    const { result } = renderHook(() => useRestoreSkillVersion(), { wrapper });
    await result.current.mutateAsync({ id: "s1", version: 1 });
    expect(keys()).toEqual(expect.arrayContaining(EXPECTED));
    expect(qc.getQueryData(["skill", "s1"])).toEqual(SKILL);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toMatch(/\/skills\/s1\/versions\/1\/restore$/);
  });

  it("deleting a skill refreshes the list + agent tabs and drops its cached detail", async () => {
    const { wrapper, keys, qc } = setup({ ok: true });
    qc.setQueryData(["skill", "s1"], SKILL);
    const { result } = renderHook(() => useDeleteSkill(), { wrapper });
    await result.current.mutateAsync("s1");
    expect(keys()).toEqual(expect.arrayContaining([["skills"], ["agent-skills"]]));
    expect(qc.getQueryData(["skill", "s1"])).toBeUndefined();
  });
});

describe("useSetAgentSkills", () => {
  it("is optimistic: the tab shows the new order at once, then the agent + cards refetch", async () => {
    const { wrapper, keys, qc, fetchMock } = setup([]);
    qc.setQueryData(["agent-skills", "ag"], [{ agent_id: "ag", skill_id: "a", order: 0, enabled: true }]);
    const { result } = renderHook(() => useSetAgentSkills("ag"), { wrapper });
    result.current.mutate([
      { skill_id: "b", enabled: true },
      { skill_id: "a", enabled: false },
    ]);
    await waitFor(() =>
      expect(qc.getQueryData(["agent-skills", "ag"])).toEqual([
        { agent_id: "ag", skill_id: "b", order: 0, enabled: true },
        { agent_id: "ag", skill_id: "a", order: 1, enabled: false },
      ]),
    );
    await waitFor(() => expect(keys()).toEqual(expect.arrayContaining([["agent", "ag"], ["agents"], ["skills"]])));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/agents\/ag\/skills$/);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      skills: [
        { skill_id: "b", enabled: true },
        { skill_id: "a", enabled: false },
      ],
    });
  });

  it("rolls the cache back when the server refuses", async () => {
    const { wrapper, qc } = setup({ error: { code: "not_found", message: "Skill not found" } }, 404);
    const before = [{ agent_id: "ag", skill_id: "a", order: 0, enabled: true }];
    qc.setQueryData(["agent-skills", "ag"], before);
    const { result } = renderHook(() => useSetAgentSkills("ag"), { wrapper });
    result.current.mutate([{ skill_id: "zzz", enabled: true }]);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData(["agent-skills", "ag"])).toEqual(before);
  });
});
