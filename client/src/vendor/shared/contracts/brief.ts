import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief. Also holds the generated-brief contracts
 * (SPEC-03): RiskKind, ReviewFocusItem, BriefModelOutput, BriefRecord,
 * BriefResponse.
 */

// ---- Intent ----
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

export const BlastDegradedReason = z.enum([
  'flag_off', 'index_failed', 'index_partial', 'repo_too_large', 'no_data',
]);
export type BlastDegradedReason = z.infer<typeof BlastDegradedReason>;

export const PrBlastRadius = BlastRadius.extend({
  pr_id: z.string(),
  degraded: z.boolean(),
  reason: BlastDegradedReason.nullable(),
});
export type PrBlastRadius = z.infer<typeof PrBlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const RiskKind = z.enum([
  'security', 'dependency', 'performance', 'breaking_change', 'data', 'config', 'other',
]);
export type RiskKind = z.infer<typeof RiskKind>;

export const Risk = z.object({
  kind: RiskKind,
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- Generated PR Brief (SPEC-03) ----
// Sent to OpenAI strict json_schema: no .transform()/.default(), and no length/range
// checks (.min/.max) — strict mode rejects the keywords they emit (minLength, …).
// Use .refine(), which validates at parse time without emitting a keyword.
const NonBlank = z.string().refine((s) => s.trim().length > 0, { message: 'must not be blank' });

export const ReviewFocusItem = z.object({
  file: NonBlank,
  line: z.number().int().refine((n) => n >= 1, { message: 'line must be >= 1' }),
  reason: NonBlank,
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

export const BriefModelOutput = z.object({
  summary: NonBlank,
  risks: z.array(Risk),
  review_focus: z.array(ReviewFocusItem),
});
export type BriefModelOutput = z.infer<typeof BriefModelOutput>;

export const BriefMissingInput = z.object({
  input: z.enum(['intent', 'blast', 'linked_issue', 'specs']),
  reason: z.string(),
});
export type BriefMissingInput = z.infer<typeof BriefMissingInput>;

export const BriefTrimmedInput = z.enum(['specs', 'linked_issue', 'description']);
export type BriefTrimmedInput = z.infer<typeof BriefTrimmedInput>;

export const BriefRecord = z.object({
  pr_id: z.string(),
  head_sha: z.string(),
  generated_at: z.string(),
  model: z.string(),
  summary: z.string(),
  risks: z.array(Risk),
  review_focus: z.array(ReviewFocusItem),
  missing_inputs: z.array(BriefMissingInput),
  trimmed_inputs: z.array(BriefTrimmedInput),
  dropped: z.object({
    risks: z.number().int(),
    review_focus: z.number().int(),
  }),
  input_tokens: z.number().int(),
  cost_usd: z.number().nullable(),
});
export type BriefRecord = z.infer<typeof BriefRecord>;

export const BriefResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('none') }),
  z.object({
    status: z.literal('ready'),
    stale: z.boolean(),
    current_head_sha: z.string(),
    brief: BriefRecord,
  }),
]);
export type BriefResponse = z.infer<typeof BriefResponse>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;
