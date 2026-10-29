import { SEV, type IconName } from "@devdigest/ui";
import type { RiskKind, RiskSeverity } from "@devdigest/shared";

/** One fixed icon per risk kind (AC-64); colour comes from severity, never from the kind. */
export const KIND_ICON: Record<RiskKind, IconName> = {
  security: "Shield",
  dependency: "Boxes",
  performance: "Zap",
  breaking_change: "GitMerge",
  data: "Database",
  config: "Settings",
  other: "Tag",
};

/** Risk severity -> the finding severity colours of the existing SEV map (AC-67). */
export const SEVERITY_COLOR: Record<RiskSeverity, string> = {
  high: SEV.CRITICAL.c,
  medium: SEV.WARNING.c,
  low: SEV.INFO.c,
};

export const SEVERITY_RANK: Record<RiskSeverity, number> = { high: 0, medium: 1, low: 2 };
