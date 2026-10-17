import { describe, it, expect } from "vitest";
import type { SkillImportPreview } from "@devdigest/shared";
import { bytesToBase64, hasNameConflict, isImportable } from "./helpers";

describe("bytesToBase64", () => {
  it("round-trips, including inputs larger than one chunk", () => {
    const big = new Uint8Array(100_000).map((_, i) => i % 256);
    const back = Uint8Array.from(atob(bytesToBase64(big)), (c) => c.charCodeAt(0));
    expect(back).toEqual(big);
    expect(bytesToBase64(new TextEncoder().encode("hi"))).toBe("aGk=");
  });
});

describe("isImportable", () => {
  it("accepts .md/.markdown/.zip only", () => {
    for (const f of ["a.md", "A.MD", "x.markdown", "pack.zip"]) expect(isImportable(f)).toBe(true);
    for (const f of ["a.sh", "a.exe", "zip", "a.md.exe", "a.tar.gz"]) expect(isImportable(f)).toBe(false);
  });
});

describe("hasNameConflict", () => {
  const p = { name: "dup", name_conflict: true } as SkillImportPreview;
  it("applies only while the name is unchanged", () => {
    expect(hasNameConflict(p, "dup")).toBe(true);
    expect(hasNameConflict(p, " dup ")).toBe(true);
    expect(hasNameConflict(p, "dup-2")).toBe(false);
    expect(hasNameConflict({ ...p, name_conflict: false }, "dup")).toBe(false);
  });
});
