import type { PrBlastRadius } from "@devdigest/shared";

export interface BlastCounts {
  symbols: number;
  callers: number;
  endpoints: number;
  crons: number;
}

/** Summary-row counts. Callers are summed; endpoints/crons are unique across groups. */
export function summarize(blast: PrBlastRadius): BlastCounts {
  const endpoints = new Set<string>();
  const crons = new Set<string>();
  let callers = 0;
  for (const group of blast.downstream) {
    callers += group.callers.length;
    group.endpoints_affected.forEach((e) => endpoints.add(e));
    group.crons_affected.forEach((c) => crons.add(c));
  }
  return { symbols: blast.changed_symbols.length, callers, endpoints: endpoints.size, crons: crons.size };
}
