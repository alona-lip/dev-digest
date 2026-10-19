import { describe, it, expect } from "vitest";
import type { ConventionSkillDraft } from "@devdigest/shared";
import { defaultAgentId, nextVersion } from "./helpers";

const draft = (existing: ConventionSkillDraft["existing_skill"]): ConventionSkillDraft => ({
  name: "repo-conventions",
  description: "d",
  type: "convention",
  enabled: true,
  body: "b",
  accepted_count: 1,
  existing_skill: existing,
});

describe("defaultAgentId", () => {
  it("prefers General Reviewer, then the first agent, then none", () => {
    expect(defaultAgentId([{ id: "a", name: "Security Reviewer" }, { id: "g", name: "General Reviewer" }])).toBe("g");
    expect(defaultAgentId([{ id: "a", name: "Security Reviewer" }])).toBe("a");
    expect(defaultAgentId([])).toBe("");
  });
});

describe("nextVersion", () => {
  it("is v1 for a new skill", () => {
    expect(nextVersion(draft(null), "repo-conventions")).toBe(1);
  });
  it("is the next version of the existing skill while the name is unchanged", () => {
    expect(nextVersion(draft({ id: "s", version: 4 }), " repo-conventions ")).toBe(5);
  });
  it("is v1 once the name no longer matches the existing skill", () => {
    expect(nextVersion(draft({ id: "s", version: 4 }), "team-rules")).toBe(1);
  });
});
