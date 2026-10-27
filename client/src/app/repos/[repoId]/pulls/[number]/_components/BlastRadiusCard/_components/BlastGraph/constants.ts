export const GRAPH = {
  WIDTH: 760,
  NODE_WIDTH: 200,
  NODE_HEIGHT: 24,
  ROW_GAP: 10,
  PAD: 12,
  MAX_LABEL_CHARS: 28,
} as const;

export const NODE_KINDS = ["symbol", "caller", "endpoint", "cron"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const LEGEND: readonly NodeKind[] = NODE_KINDS;
