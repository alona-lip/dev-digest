import { describe, it, expect } from "vitest";
import { approxTokens, bodyFileName, parseTabParam } from "./helpers";

describe("skill editor helpers", () => {
  it("parseTabParam falls back to config", () => {
    expect(parseTabParam("stats")).toBe("stats");
    expect(parseTabParam("versions")).toBe("versions");
    expect(parseTabParam("nope")).toBe("config");
    expect(parseTabParam(null)).toBe("config");
  });
  it("approxTokens is chars / 4, rounded up", () => {
    expect(approxTokens("")).toBe(0);
    expect(approxTokens("abcde")).toBe(2);
  });
  it("bodyFileName makes a safe .md name", () => {
    expect(bodyFileName("pr-quality-rubric")).toBe("pr-quality-rubric.md");
    expect(bodyFileName("my skill/../x")).toBe("my-skill-..-x.md");
    expect(bodyFileName("  ")).toBe("skill.md");
  });
});
