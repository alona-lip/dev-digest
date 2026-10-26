import { describe, it, expect } from "vitest";
import type { PrBlastRadius } from "@devdigest/shared";
import { connectedTo, layoutGraph, truncate } from "./helpers";

const base: PrBlastRadius = {
  pr_id: "pr-1",
  changed_symbols: [{ name: "getContext", file: "a.ts", kind: "function" }],
  downstream: [
    {
      symbol: "getContext",
      callers: [
        { name: "settingsRoutes", file: "s.ts", line: 3 },
        { name: "reposRoutes", file: "r.ts", line: 9 },
      ],
      endpoints_affected: ["GET /settings"],
      crons_affected: ["job:poll"],
    },
  ],
  summary: "",
  degraded: false,
  reason: null,
};

describe("layoutGraph", () => {
  it("lays out three columns with one edge per symbol->caller and symbol->target pair", () => {
    const { nodes, edges } = layoutGraph(base);
    expect(new Set(nodes.map((n) => n.x)).size).toBe(3);
    // 2 symbol->caller + 2 symbol->target (endpoints are per symbol group, not per caller)
    expect(edges).toHaveLength(2 + 2);
    const sym = nodes.find((n) => n.kind === "symbol")!;
    const target = (k: string) => nodes.find((n) => n.kind === k)!;
    expect(edges.map((e) => e.id)).toEqual(
      expect.arrayContaining([`${sym.id}->${target("endpoint").id}`, `${sym.id}->${target("cron").id}`]),
    );
    expect(edges.some((e) => nodes.find((n) => n.id === e.from)?.kind === "caller")).toBe(false);
    expect(nodes.filter((n) => n.kind === "endpoint")).toHaveLength(1);
    expect(nodes.filter((n) => n.kind === "cron")).toHaveLength(1);
  });

  it("draws only symbols that have downstream callers, not every changed symbol", () => {
    const { nodes } = layoutGraph({
      ...base,
      changed_symbols: [...base.changed_symbols, { name: "unused", file: "u.ts", kind: "function" }],
    });
    expect(nodes.filter((n) => n.kind === "symbol").map((n) => n.label)).toEqual(["getContext"]);
  });

  it("has no NaN coordinates for empty input", () => {
    const { nodes, edges, width, height } = layoutGraph({ ...base, changed_symbols: [], downstream: [] });
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
    expect(Number.isFinite(width) && Number.isFinite(height)).toBe(true);
  });

  it("connectedTo lights a symbol's own callers and targets, including a target it shares", () => {
    const layout = layoutGraph({
      ...base,
      downstream: [
        ...base.downstream,
        {
          symbol: "parseId",
          callers: [{ name: "agentsRoutes", file: "g.ts", line: 7 }],
          endpoints_affected: ["GET /settings"],
          crons_affected: [],
        },
      ],
    });
    const label = (id: string) => layout.nodes.find((n) => n.id === id)?.label;
    const litLabels = (symbol: string) =>
      [...connectedTo(layout, `s:${symbol}`)].map(label).filter(Boolean).sort();

    expect(litLabels("getContext")).toEqual(["GET /settings", "getContext", "job:poll", "reposRoutes", "settingsRoutes"]);
    expect(litLabels("parseId")).toEqual(["GET /settings", "agentsRoutes", "parseId"]);
    // The edges it lights are exactly the ones leaving the hovered symbol.
    const litEdges = layout.edges.filter((e) => connectedTo(layout, "s:parseId").has(e.id));
    expect(litEdges.map((e) => e.from)).toEqual(["s:parseId", "s:parseId"]);
  });

  it("truncates long labels", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abc", 4)).toBe("abc");
  });
});
