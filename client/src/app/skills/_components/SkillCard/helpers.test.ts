import { describe, it, expect } from "vitest";
import { filterSkills, formatRate } from "./helpers";

describe("formatRate", () => {
  it("rounds to a whole percent and never shows 0% for 'no data'", () => {
    expect(formatRate(0.714)).toBe("71%");
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(null)).toBe("—");
  });
});

describe("filterSkills", () => {
  const skills = [
    { name: "secret-leakage-gate", description: "Detects sk_live keys" },
    { name: "no-then-chains", description: "House rule: async/await" },
  ];
  it("matches name or description, case-insensitively", () => {
    expect(filterSkills(skills, "SECRET")).toHaveLength(1);
    expect(filterSkills(skills, "async")).toEqual([skills[1]]);
    expect(filterSkills(skills, "  ")).toHaveLength(2);
    expect(filterSkills(skills, "zzz")).toEqual([]);
  });
});
