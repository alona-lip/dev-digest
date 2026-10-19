import { describe, it, expect } from "vitest";
import { parseTabParam } from "./helpers";

describe("skill editor helpers", () => {
  it("parseTabParam falls back to config", () => {
    expect(parseTabParam("stats")).toBe("stats");
    expect(parseTabParam("versions")).toBe("versions");
    expect(parseTabParam("nope")).toBe("config");
    expect(parseTabParam(null)).toBe("config");
  });
});
