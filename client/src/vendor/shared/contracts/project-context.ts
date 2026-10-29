import { z } from 'zod';

/**
 * Project context (SPEC-01): `.md` documents of a cloned repo that a user
 * attaches to agents/skills and that reach the review prompt as untrusted
 * "specs". Wire fields are snake_case.
 */

/** Token budget for all attached documents of one run. */
export const PROJECT_CONTEXT_TOKEN_BUDGET = 12000;
/** Max documents returned by the list endpoint. */
export const CONTEXT_LIST_LIMIT = 500;
/** Files above this size are listed but never read. */
export const CONTEXT_MAX_FILE_BYTES = 1_048_576;

export const ContextDocType = z.enum(['specs', 'docs', 'insights']);
export type ContextDocType = z.infer<typeof ContextDocType>;

export const ContextDoc = z.object({
  path: z.string(),
  type: ContextDocType,
  size_bytes: z.number().int(),
  tokens: z.number().int().nullable(),
  too_large: z.boolean(),
});
export type ContextDoc = z.infer<typeof ContextDoc>;

export const ContextDocList = z.object({
  status: z.enum(['ok', 'not_cloned']),
  glob: z.string(),
  truncated: z.boolean(),
  read_at: z.string(),
  docs: z.array(ContextDoc),
});
export type ContextDocList = z.infer<typeof ContextDocList>;

export const ContextDocContent = z.object({
  path: z.string(),
  type: ContextDocType,
  content: z.string(),
  tokens: z.number().int(),
});
export type ContextDocContent = z.infer<typeof ContextDocContent>;

export const ContextAttachmentDoc = z.object({
  path: z.string(),
  type: ContextDocType.nullable(),
  tokens: z.number().int().nullable(),
  too_large: z.boolean(),
  missing: z.boolean(),
});
export type ContextAttachmentDoc = z.infer<typeof ContextAttachmentDoc>;

export const ContextAttachments = z.object({
  repo_id: z.string(),
  paths: z.array(z.string()),
  /** Same order as `paths`. */
  docs: z.array(ContextAttachmentDoc),
  /** Agents only (docs inherited through skills); `[]` for skills. */
  inherited: z.array(
    ContextAttachmentDoc.extend({
      via_skill: z.object({ skill_id: z.string(), name: z.string() }),
    }),
  ),
});
export type ContextAttachments = z.infer<typeof ContextAttachments>;

export const ContextAttachmentsInput = z.object({
  repo_id: z.string().uuid(),
  paths: z.array(z.string()),
});
export type ContextAttachmentsInput = z.infer<typeof ContextAttachmentsInput>;

export const ContextUsage = z.object({
  repo_id: z.string(),
  by_path: z.record(z.string(), z.object({ agents: z.number().int(), skills: z.number().int() })),
});
export type ContextUsage = z.infer<typeof ContextUsage>;

/** One document of a run's effective set, as recorded in the trace. */
export const SpecBlock = z.object({
  path: z.string(),
  type: ContextDocType,
  origin: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('agent') }),
    z.object({ kind: z.literal('skill'), skill_id: z.string(), name: z.string() }),
  ]),
  status: z.enum(['attached', 'missing', 'over_budget']),
  /** 0 for an empty doc; null for `missing` and for a file now > 1 MB. */
  tokens: z.number().int().nullable(),
  /** The added text; only for `attached`. */
  text: z.string().nullable(),
});
export type SpecBlock = z.infer<typeof SpecBlock>;
