import { describe, it, expect } from "vitest";
import type { PrCommit, RunSummary } from "@devdigest/shared";
import { outcomeOf, timelineItems, tsOf } from "./helpers";

const run = (over: Partial<RunSummary>): RunSummary =>
  ({ run_id: "r", status: "done", findings_count: 0, blockers: 0, ran_at: null, ...over }) as RunSummary;

describe("outcomeOf", () => {
  it("reads the lifecycle while a run is not settled", () => {
    expect(outcomeOf(run({ status: "running" })).key).toBe("running");
    expect(outcomeOf(run({ status: "failed" })).key).toBe("error");
    expect(outcomeOf(run({ status: "cancelled" })).key).toBe("cancelled");
  });

  it("colours a settled run by its deterministic outcome, never a plain 'done'", () => {
    expect(outcomeOf(run({ blockers: 1, findings_count: 3 })).key).toBe("rejected");
    expect(outcomeOf(run({ findings_count: 2 })).key).toBe("reviewed");
    expect(outcomeOf(run({})).key).toBe("approved");
  });
});

describe("timelineItems", () => {
  it("interleaves runs and commits newest first; undated items sort last", () => {
    const items = timelineItems(
      [run({ run_id: "r1", ran_at: "2026-10-02T00:00:00Z" }), run({ run_id: "r0" })],
      [{ sha: "c1", message: "m", author: "a", committed_at: "2026-10-01T00:00:00Z" } as PrCommit],
    );
    expect(items.map((i) => (i.kind === "run" ? i.run.run_id : i.commit.sha))).toEqual(["r1", "c1", "r0"]);
  });
});

describe("tsOf", () => {
  it("treats missing and unparseable timestamps as 0", () => {
    expect(tsOf(null)).toBe(0);
    expect(tsOf("not a date")).toBe(0);
    expect(tsOf("2026-10-01T00:00:00Z")).toBeGreaterThan(0);
  });
});
