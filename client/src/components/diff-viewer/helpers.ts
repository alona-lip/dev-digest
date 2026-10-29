/** Pure helpers for the DiffViewer. */
import type { PrFile } from "@/lib/types";
import { HUNK_HEADER_RE } from "./constants";

export interface Line {
  kind: "add" | "del" | "ctx" | "hunk";
  text: string;
  oldNo?: number;
  newNo?: number;
}

/** Parse unified-diff patch text into renderable lines with old/new line numbers. */
export function parsePatch(patch: string | null | undefined): Line[] {
  if (!patch) return [];
  const out: Line[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = raw.match(HUNK_HEADER_RE);
      if (m) {
        oldNo = parseInt(m[1]!, 10);
        newNo = parseInt(m[2]!, 10);
      }
      out.push({ kind: "hunk", text: raw });
    } else if (raw.startsWith("+")) {
      out.push({ kind: "add", text: raw.slice(1), newNo });
      newNo++;
    } else if (raw.startsWith("-")) {
      out.push({ kind: "del", text: raw.slice(1), oldNo });
      oldNo++;
    } else {
      out.push({ kind: "ctx", text: raw.slice(raw.startsWith(" ") ? 1 : 0), oldNo, newNo });
      oldNo++;
      newNo++;
    }
  }
  return out;
}

export interface ResolvedTarget {
  /** Matching `files[].path`, or null when the file is not rendered. */
  file: string | null;
  /** Index into `parsePatch(file.patch)` of the target line, or null when not rendered. */
  lineIndex: number | null;
}

/**
 * Resolve a deep-link target (`file`, `line`) against the rendered files.
 * The file is only compared with `files[].path` (never used as a path). The
 * line matches the new-side number first, then the old-side number of a deletion.
 */
export function resolveTarget(
  files: PrFile[],
  target: { file: string; line: number | null }
): ResolvedTarget {
  const f = files.find((x) => x.path === target.file);
  if (!f) return { file: null, lineIndex: null };
  if (target.line === null) return { file: f.path, lineIndex: null };
  const lines = parsePatch(f.patch);
  let i = lines.findIndex((l) => l.kind !== "hunk" && l.newNo === target.line);
  if (i < 0) i = lines.findIndex((l) => l.kind === "del" && l.oldNo === target.line);
  return { file: f.path, lineIndex: i < 0 ? null : i };
}
