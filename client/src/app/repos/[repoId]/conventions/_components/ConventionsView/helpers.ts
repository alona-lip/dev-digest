import type { ConventionCandidate } from "@devdigest/shared";

/** Ids of the candidates that go into the skill. */
export function acceptedIds(candidates: ConventionCandidate[]): string[] {
  return candidates.filter((c) => c.status === "ACCEPTED").map((c) => c.id);
}
