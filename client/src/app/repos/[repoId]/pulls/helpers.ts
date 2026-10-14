import {
  OPEN_STATUSES,
  SIZE_MEDIUM_MAX,
  SIZE_SMALL_MAX,
  SORT_ORDERS,
  type PrMeta,
  type SizeInfo,
  type SortOrder,
} from "./constants";

/** Bucket a PR into S/M/L by total changed lines. */
export function sizeOf(pr: PrMeta): SizeInfo {
  const lines = pr.additions + pr.deletions;
  const size = lines < SIZE_SMALL_MAX ? "S" : lines < SIZE_MEDIUM_MAX ? "M" : "L";
  return { size, lines };
}

/** Compact relative time for the list's UPDATED column (e.g. "3h", "2d"). */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const m = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** The rows the list shows: status filter → title/#number search → sort by last update. */
export function filterPulls(
  pulls: PrMeta[],
  { status, query, sort }: { status: string; query: string; sort: SortOrder },
): PrMeta[] {
  const q = query.trim().toLowerCase();
  return pulls
    .filter((p) => status === "all" || p.status === status)
    .filter((p) => !q || p.title.toLowerCase().includes(q) || String(p.number).includes(q))
    .slice()
    .sort((a, b) => {
      const ta = Date.parse(a.updated_at ?? "") || 0;
      const tb = Date.parse(b.updated_at ?? "") || 0;
      return sort === "oldest" ? ta - tb : tb - ta;
    });
}

/** Header counts: open PRs (any derived review status) and those needing review. */
export function countPulls(pulls: PrMeta[]): { open: number; needsReview: number } {
  return {
    open: pulls.filter((p) => OPEN_STATUSES.has(p.status)).length,
    needsReview: pulls.filter((p) => p.status === "needs_review").length,
  };
}

/** `?sort=` → a known order (unknown/missing → newest). */
export function parseSortParam(raw: string | null): SortOrder {
  return (SORT_ORDERS as readonly string[]).includes(raw ?? "") ? (raw as SortOrder) : SORT_ORDERS[0];
}
