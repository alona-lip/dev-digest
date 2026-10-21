import { describe, it, expect } from "vitest";
import type { SkillImportPreview } from "@devdigest/shared";
import { hasNameConflict } from "./helpers";

describe("hasNameConflict", () => {
  const p = { name: "dup", name_conflict: true } as SkillImportPreview;
  it("applies only while the name is unchanged", () => {
    expect(hasNameConflict(p, "dup")).toBe(true);
    expect(hasNameConflict(p, " dup ")).toBe(true);
    expect(hasNameConflict(p, "dup-2")).toBe(false);
    expect(hasNameConflict({ ...p, name_conflict: false }, "dup")).toBe(false);
  });
});
