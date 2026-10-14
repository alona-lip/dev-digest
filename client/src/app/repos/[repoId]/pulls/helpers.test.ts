import { describe, it, expect } from "vitest";
import type { PrMeta } from "@/lib/types";
import { countPulls, filterPulls, parseSortParam, sizeOf } from "./helpers";

function pr(number: number, status: PrMeta["status"], title: string, updated_at: string): PrMeta {
  return {
    id: `id-${number}`,
    number,
    title,
    author: "a",
    branch: "b",
    base: "main",
    head_sha: "sha",
    additions: 10,
    deletions: 5,
    files_count: 1,
    status,
    updated_at,
  };
}

const PULLS = [
  pr(1, "needs_review", "Add rate limit", "2026-10-01T00:00:00Z"),
  pr(2, "reviewed", "Fix login", "2026-10-03T00:00:00Z"),
  pr(3, "merged", "Bump deps", "2026-10-02T00:00:00Z"),
  pr(4, "stale", "Refactor rate limiter", "2026-09-01T00:00:00Z"),
];

describe("filterPulls", () => {
  it("filters by status, newest update first", () => {
    expect(filterPulls(PULLS, { status: "all", query: "", sort: "newest" }).map((p) => p.number)).toEqual([
      2, 3, 1, 4,
    ]);
    expect(filterPulls(PULLS, { status: "needs_review", query: "", sort: "newest" }).map((p) => p.number)).toEqual([1]);
  });

  it("searches title (case-insensitive) and PR number", () => {
    expect(filterPulls(PULLS, { status: "all", query: "RATE", sort: "newest" }).map((p) => p.number)).toEqual([1, 4]);
    expect(filterPulls(PULLS, { status: "all", query: " 3 ", sort: "newest" }).map((p) => p.number)).toEqual([3]);
  });

  it("sorts oldest first on request and does not mutate the input", () => {
    const before = PULLS.map((p) => p.number);
    expect(filterPulls(PULLS, { status: "all", query: "", sort: "oldest" }).map((p) => p.number)).toEqual([
      4, 1, 3, 2,
    ]);
    expect(PULLS.map((p) => p.number)).toEqual(before);
  });
});

describe("countPulls", () => {
  it("counts open (derived review statuses) and needs-review PRs", () => {
    expect(countPulls(PULLS)).toEqual({ open: 3, needsReview: 1 });
  });
});

describe("parseSortParam", () => {
  it("accepts known orders and defaults the rest to newest", () => {
    expect(parseSortParam("oldest")).toBe("oldest");
    expect(parseSortParam("newest")).toBe("newest");
    expect(parseSortParam("bogus")).toBe("newest");
    expect(parseSortParam(null)).toBe("newest");
  });
});

describe("sizeOf", () => {
  it("buckets by total changed lines", () => {
    expect(sizeOf({ ...PULLS[0]!, additions: 50, deletions: 49 }).size).toBe("S");
    expect(sizeOf({ ...PULLS[0]!, additions: 100, deletions: 0 }).size).toBe("M");
    expect(sizeOf({ ...PULLS[0]!, additions: 400, deletions: 0 }).size).toBe("L");
  });
});
