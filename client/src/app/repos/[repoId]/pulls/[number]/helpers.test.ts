import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { countBlockers } from "./helpers";

const f = (severity: FindingRecord["severity"], dismissed_at: string | null = null) => ({ severity, dismissed_at });

describe("countBlockers", () => {
  it("counts open CRITICAL findings only", () => {
    expect(countBlockers([f("CRITICAL"), f("CRITICAL", "2026-10-01"), f("WARNING"), f("SUGGESTION")])).toBe(1);
  });

  it("is 0 for no findings", () => {
    expect(countBlockers([])).toBe(0);
  });
});
