import { describe, it, expect } from "vitest";
import type { ContextAttachments, ContextDoc } from "@devdigest/shared";
import {
  applyBudget,
  effectiveSet,
  filterRows,
  inheritedRows,
  mergeRows,
  movePath,
  splitPath,
  sumTokens,
  togglePath,
  type EffectiveItem,
} from "./helpers";

const item = (path: string, tokens: number | null, too_large = false): EffectiveItem => ({
  path,
  tokens,
  too_large,
});

describe("applyBudget (mirror of the server helper)", () => {
  it("7k / 7k / 2k: the second is skipped, the third still fits", () => {
    const r = applyBudget([item("a", 7000), item("b", 7000), item("c", 2000)], 12000);
    expect(r.map((x) => x.status)).toEqual(["attached", "over_budget", "attached"]);
  });

  it("null tokens and > 1 MB are over_budget without using budget", () => {
    const r = applyBudget([item("n", null), item("big", 5, true), item("a", 12000)], 12000);
    expect(r.map((x) => x.status)).toEqual(["over_budget", "over_budget", "attached"]);
  });

  it("defaults to the shared 12000 budget", () => {
    expect(applyBudget([item("a", 12000), item("b", 1)]).map((x) => x.status)).toEqual([
      "attached",
      "over_budget",
    ]);
  });
});

describe("path list helpers", () => {
  it("togglePath detaches an attached path and appends a new one", () => {
    expect(togglePath(["a", "b"], "a")).toEqual(["b"]);
    expect(togglePath(["a", "b"], "c")).toEqual(["a", "b", "c"]);
  });

  it("movePath moves a path to another's position, ignores unknown paths", () => {
    expect(movePath(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(movePath(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(movePath(["a", "b"], "a", "x")).toEqual(["a", "b"]);
  });

  it("filterRows is a case-insensitive substring match on the path", () => {
    const rows = [{ path: "Specs/Auth.md" }, { path: "docs/x.md" }];
    expect(filterRows(rows, "  AUTH ")).toEqual([{ path: "Specs/Auth.md" }]);
    expect(filterRows(rows, "")).toHaveLength(2);
  });

  it("splitPath separates the file name from the directory", () => {
    expect(splitPath("a/b/c.md")).toEqual({ name: "c.md", dir: "a/b" });
    expect(splitPath("c.md")).toEqual({ name: "c.md", dir: "" });
  });
});

const doc = (path: string, over: Partial<ContextDoc> = {}): ContextDoc => ({
  path,
  type: "docs",
  size_bytes: 1,
  tokens: 10,
  too_large: false,
  ...over,
});

const att = (over: Partial<ContextAttachments>): ContextAttachments => ({
  repo_id: "r",
  paths: [],
  docs: [],
  inherited: [],
  ...over,
});

describe("mergeRows", () => {
  it("lists attached paths first in order, a missing path as its own row, then the rest", () => {
    const rows = mergeRows(
      [doc("a.md"), doc("b.md"), doc("c.md")],
      att({
        paths: ["c.md", "gone.md"],
        docs: [
          { path: "c.md", type: "docs", tokens: 10, too_large: false, missing: false },
          { path: "gone.md", type: null, tokens: null, too_large: false, missing: true },
        ],
      }),
    );
    expect(rows.map((r) => [r.path, r.attached, r.missing])).toEqual([
      ["c.md", true, false],
      ["gone.md", true, true],
      ["a.md", false, false],
      ["b.md", false, false],
    ]);
  });
});

describe("effectiveSet / inheritedRows / sumTokens", () => {
  const a = att({
    paths: ["own.md", "both.md", "gone.md"],
    docs: [
      { path: "own.md", type: "docs", tokens: 100, too_large: false, missing: false },
      { path: "both.md", type: "docs", tokens: 50, too_large: false, missing: false },
      { path: "gone.md", type: null, tokens: null, too_large: false, missing: true },
    ],
    inherited: [
      {
        path: "both.md",
        type: "docs",
        tokens: 50,
        too_large: false,
        missing: false,
        via_skill: { skill_id: "s", name: "rubric" },
      },
      {
        path: "inh.md",
        type: "docs",
        tokens: 25,
        too_large: false,
        missing: false,
        via_skill: { skill_id: "s", name: "rubric" },
      },
    ],
  });

  it("own first, then inherited, no duplicates, missing dropped", () => {
    expect(effectiveSet(a).map((i) => i.path)).toEqual(["own.md", "both.md", "inh.md"]);
    expect(sumTokens(effectiveSet(a))).toBe(175);
  });

  it("an inherited path the owner also attached is shown once, as its own", () => {
    expect(inheritedRows(a).map((r) => r.path)).toEqual(["inh.md"]);
  });

  it("an empty set is 0 tokens", () => {
    expect(sumTokens(effectiveSet(undefined))).toBe(0);
    expect(sumTokens([item("e", 0)])).toBe(0);
  });
});
