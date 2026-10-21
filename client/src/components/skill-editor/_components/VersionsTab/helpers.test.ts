import { describe, it, expect } from "vitest";
import { lineDiff, shortDate } from "./helpers";

describe("lineDiff", () => {
  it("marks added, removed and unchanged lines", () => {
    const d = lineDiff("a\nb\nc", "a\nB\nc\nd");
    expect(d).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "B" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ]);
  });
  it("identical text is all 'same'; empty → full add / del", () => {
    expect(lineDiff("x\ny", "x\ny").every((l) => l.kind === "same")).toBe(true);
    expect(lineDiff("", "z")).toEqual([
      { kind: "del", text: "" },
      { kind: "add", text: "z" },
    ]);
  });
});

describe("shortDate", () => {
  it("keeps the date part", () => expect(shortDate("2026-05-30T10:00:00Z")).toBe("2026-05-30"));
});
