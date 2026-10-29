import { describe, it, expect } from "vitest";
import type { PrFile } from "@/lib/types";
import { resolveTarget } from "./helpers";

const file = (path: string, patch: string): PrFile =>
  ({ path, additions: 1, deletions: 1, patch }) as PrFile;

const PATCH = "@@ -10,3 +20,3 @@\n ctx\n-gone\n+added\n tail";

describe("resolveTarget", () => {
  const files = [file("a.ts", PATCH)];
  it("matches the new-side number, then the old-side of a deletion", () => {
    expect(resolveTarget(files, { file: "a.ts", line: 20 })).toEqual({ file: "a.ts", lineIndex: 1 });
    expect(resolveTarget(files, { file: "a.ts", line: 21 })).toEqual({ file: "a.ts", lineIndex: 3 });
    // old-side 11 is the deletion (new-side 11 does not exist)
    expect(resolveTarget(files, { file: "a.ts", line: 11 })).toEqual({ file: "a.ts", lineIndex: 2 });
  });
  it("unknown file -> nulls; unrendered line or no line -> file only", () => {
    expect(resolveTarget(files, { file: "x.ts", line: 1 })).toEqual({ file: null, lineIndex: null });
    expect(resolveTarget(files, { file: "a.ts", line: 999 })).toEqual({ file: "a.ts", lineIndex: null });
    expect(resolveTarget(files, { file: "a.ts", line: null })).toEqual({ file: "a.ts", lineIndex: null });
  });
});
