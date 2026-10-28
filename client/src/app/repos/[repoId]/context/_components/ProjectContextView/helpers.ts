import type { ContextDoc, ContextDocType } from "@devdigest/shared";
import { GROUP_ORDER } from "./constants";

/** Case-insensitive "path contains query"; an empty query keeps everything. */
export function filterDocs(docs: readonly ContextDoc[], query: string): ContextDoc[] {
  const q = query.trim().toLowerCase();
  return q ? docs.filter((d) => d.path.toLowerCase().includes(q)) : [...docs];
}

/** Non-empty groups in GROUP_ORDER, documents keeping list order. */
export function groupDocs(docs: readonly ContextDoc[]): { type: ContextDocType; docs: ContextDoc[] }[] {
  return GROUP_ORDER.map((type) => ({ type, docs: docs.filter((d) => d.type === type) })).filter(
    (g) => g.docs.length > 0,
  );
}

/** Sum of the token estimates; a null estimate (too large) counts as 0. */
export function totalTokens(docs: readonly ContextDoc[]): number {
  return docs.reduce((sum, d) => sum + (d.tokens ?? 0), 0);
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "just now" / "5 minutes ago" / "2 days ago" for an ISO timestamp. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const diff = ts - now;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return rtf.format(0, "second");
}
