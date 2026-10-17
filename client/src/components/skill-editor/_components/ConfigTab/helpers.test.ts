import { describe, it, expect } from "vitest";
import { validateSkillForm } from "./helpers";

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
