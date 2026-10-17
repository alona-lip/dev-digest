export type DiffLine = { kind: "same" | "add" | "del"; text: string };

/**
 * Line diff of `a` → `b` (longest-common-subsequence on lines). Skill bodies are
 * capped at 20k characters, so the O(n·m) table stays small.
 */
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a.split("\n");
  const y = b.split("\n");
  const lcs: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i]![j] = x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) out.push({ kind: "same", text: x[i++]! }), j++;
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ kind: "del", text: x[i++]! });
    else out.push({ kind: "add", text: y[j++]! });
  }
  while (i < x.length) out.push({ kind: "del", text: x[i++]! });
  while (j < y.length) out.push({ kind: "add", text: y[j++]! });
  return out;
}

/** `2026-05-30T…` → `2026-05-30`. */
export function shortDate(iso: string): string {
  return iso.slice(0, 10);
}
