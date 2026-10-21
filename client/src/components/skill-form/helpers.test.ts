import { describe, it, expect } from "vitest";
import { approxTokens, bodyFileName, validateSkillForm } from "./helpers";

const ok = { name: "n", description: "d", body: "b" };

describe("validateSkillForm", () => {
  it("accepts a complete form", () => expect(validateSkillForm(ok)).toBeNull());
  it("reports the first problem, mirroring the server limits", () => {
    expect(validateSkillForm({ ...ok, name: "  " })).toBe("name");
    expect(validateSkillForm({ ...ok, name: "x".repeat(81) })).toBe("nameLong");
    expect(validateSkillForm({ ...ok, description: "" })).toBe("description");
    expect(validateSkillForm({ ...ok, description: "x".repeat(501) })).toBe("descriptionLong");
    expect(validateSkillForm({ ...ok, body: " \n" })).toBe("body");
    expect(validateSkillForm({ ...ok, body: "x".repeat(20_001) })).toBe("bodyLong");
  });
});

describe("body helpers", () => {
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
