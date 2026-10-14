import type { Finding } from '@devdigest/shared';
import type { FindingRow } from '../../db/rows.js';

/**
 * Finding row → wire DTO. Shared presentation mapping: `reviews` (PR detail,
 * finding actions) and `pulls` (the PR-list findings popover) both render it,
 * so it lives here instead of one module importing the other's helpers.
 */

export interface ReviewDtoFinding extends Finding {
  review_id: string;
  accepted_at: string | null;
  dismissed_at: string | null;
}

export function findingRowToDto(row: FindingRow): ReviewDtoFinding {
  return {
    id: row.id,
    severity: row.severity as Finding['severity'],
    category: row.category as Finding['category'],
    title: row.title,
    file: row.file,
    start_line: row.startLine,
    end_line: row.endLine,
    rationale: row.rationale,
    suggestion: row.suggestion ?? null,
    confidence: row.confidence,
    kind: (row.kind as Finding['kind']) ?? 'finding',
    trifecta_components: (row.trifectaComponents as Finding['trifecta_components']) ?? null,
    evidence: null,
    review_id: row.reviewId,
    accepted_at: row.acceptedAt?.toISOString() ?? null,
    dismissed_at: row.dismissedAt?.toISOString() ?? null,
  };
}
