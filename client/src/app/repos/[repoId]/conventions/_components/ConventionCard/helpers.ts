import { CONFIDENCE_HIGH_PCT, CONFIDENCE_MID_PCT } from "./constants";

/** 0..1 → the whole percent shown on the card. */
export function confidencePct(confidence: number): number {
  return Math.round(Math.max(0, Math.min(1, confidence)) * 100);
}

/** Colour of the confidence bar, from the same rounded percent as the label. */
export function confidenceColor(confidence: number): string {
  const pct = confidencePct(confidence);
  if (pct >= CONFIDENCE_HIGH_PCT) return "var(--ok)";
  if (pct >= CONFIDENCE_MID_PCT) return "var(--warn)";
  return "var(--text-muted)";
}
