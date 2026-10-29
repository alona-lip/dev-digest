import { describe, it, expect } from "vitest";
import { parseTabParam } from "./helpers";

describe("parseTabParam", () => {
  it("accepts the editor's tabs, including ?tab=skills", () => {
    expect(parseTabParam("config")).toBe("config");
    expect(parseTabParam("skills")).toBe("skills");
    expect(parseTabParam("context")).toBe("context");
  });

  it("falls back to Config for an unknown or missing tab", () => {
    expect(parseTabParam("evals")).toBe("config");
    expect(parseTabParam("")).toBe("config");
    expect(parseTabParam(null)).toBe("config");
  });
});
