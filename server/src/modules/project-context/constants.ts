import {
  CONTEXT_LIST_LIMIT,
  CONTEXT_MAX_FILE_BYTES,
  PROJECT_CONTEXT_TOKEN_BUDGET,
} from '@devdigest/shared';
import type { ContextDocType } from '@devdigest/shared';

export { CONTEXT_LIST_LIMIT, CONTEXT_MAX_FILE_BYTES, PROJECT_CONTEXT_TOKEN_BUDGET };

/** Path segments that classify a document; the deepest one wins. */
export const DOC_BUCKETS = ['specs', 'docs', 'insights'] as const satisfies readonly ContextDocType[];

/** File name (compared lowercased) that always types a document `insights`. */
export const INSIGHTS_FILE_NAME = 'insights.md';

/** Type for a path with no bucket segment and not an INSIGHTS.md (only possible with a custom glob). */
export const DEFAULT_DOC_TYPE: ContextDocType = 'docs';
