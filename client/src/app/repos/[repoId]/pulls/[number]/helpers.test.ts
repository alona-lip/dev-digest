import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { countBlockers, parseDiffTarget, diffTargetQuery } from "./helpers";

const f = (severity: FindingRecord["severity"], dismissed_at: string | null = null) => ({ severity, dismissed_at });

describe("countBlockers", () => {
  it("counts open CRITICAL findings only", () => {
    expect(countBlockers([f("CRITICAL"), f("CRITICAL", "2026-10-01"), f("WARNING"), f("SUGGESTION")])).toBe(1);
  });

  it("is 0 for no findings", () => {
    expect(countBlockers([])).toBe(0);
  });
});

describe("parseDiffTarget", () => {
  const sp = (q: string) => new URLSearchParams(q);

  it("AC-57: reads file and line", () => {
    expect(parseDiffTarget(sp("tab=diff&file=src%2Fa.ts&line=25"))).toEqual({ file: "src/a.ts", line: 25 });
  });

  it("AC-61: invalid line becomes null, empty or missing file gives null", () => {
    for (const bad of ["0", "-3", "1.5", "abc", ""]) {
      expect(parseDiffTarget(sp(`file=a.ts&line=${bad}`))).toEqual({ file: "a.ts", line: null });
    }
    expect(parseDiffTarget(sp("file=a.ts"))).toEqual({ file: "a.ts", line: null });
    expect(parseDiffTarget(sp("file=&line=3"))).toBeNull();
    expect(parseDiffTarget(sp("line=3"))).toBeNull();
  });
});

describe("diffTargetQuery", () => {
  it("AC-57: sets tab, file and line and preserves other params", () => {
    const q = diffTargetQuery(new URLSearchParams("tab=overview&severity=CRITICAL"), "src/a.ts", 25);
    expect(new URLSearchParams(q).toString()).toBe("tab=diff&severity=CRITICAL&file=src%2Fa.ts&line=25");
  });

  it("AC-59: a null line removes a stale line param", () => {
    const q = diffTargetQuery(new URLSearchParams("tab=diff&file=old.ts&line=9"), "b.ts", null);
    expect(q).toBe("tab=diff&file=b.ts");
  });
});
