import { z } from 'zod';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

export const SkillSource = z.enum([
  'manual',
  'imported_url',
  'imported_file',
  'extracted',
  'community',
]);
export type SkillSource = z.infer<typeof SkillSource>;

/** One prompt-injection hit: a pattern rule (with its line) or a model verdict. */
export const SkillScanFinding = z.object({
  rule: z.string(),
  label: z.string(),
  /** 1-based body line; null when the model did not point at one. */
  line: z.number().int().nullable(),
  excerpt: z.string(),
  source: z.enum(['pattern', 'llm']),
});
export type SkillScanFinding = z.infer<typeof SkillScanFinding>;

export const SkillScanStatus = z.enum(['clean', 'injection']);
export type SkillScanStatus = z.infer<typeof SkillScanStatus>;

/**
 * Result of scanning a skill body for prompt injection. `pattern` = the
 * deterministic scan run on every save; `llm` = the last Re-scan also asked a
 * model. Either detector firing makes the status `injection`.
 */
export const SkillScan = z.object({
  status: SkillScanStatus,
  method: z.enum(['pattern', 'llm']),
  findings: z.array(SkillScanFinding),
  /** When the stored result was written; null for an unsaved import preview. */
  scanned_at: z.string().nullable(),
});
export type SkillScan = z.infer<typeof SkillScan>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
  /** Token count of `body` (server tokenizer). */
  tokens: z.number().int(),
  created_at: z.string(),
  /** Prompt-injection scan of the current body. `injection` = blocked (cannot be enabled). */
  scan: SkillScan,
});
export type Skill = z.infer<typeof Skill>;

/** Skill + the rollups shown on the list card. null rate = no data yet. */
export const SkillListItem = Skill.extend({
  agent_count: z.number().int(),
  pull_rate: z.number().min(0).max(1).nullable(),
  accept_rate: z.number().min(0).max(1).nullable(),
});
export type SkillListItem = z.infer<typeof SkillListItem>;

export const CreateSkillInput = z.object({
  name: z.string().trim().min(1).max(80),
  // The description is the skill's interface: written as a directive
  // ("Use when …, do …"), not a summary.
  description: z.string().trim().min(1).max(500),
  type: SkillType,
  body: z.string().min(1).max(20_000),
  enabled: z.boolean().optional(),
  source: z.enum(['manual', 'imported_url', 'imported_file', 'extracted']).optional(),
});
export type CreateSkillInput = z.infer<typeof CreateSkillInput>;

export const UpdateSkillInput = CreateSkillInput.omit({ source: true })
  .partial()
  .extend({
    /** Note stored with the new version snapshot when `body` changes. */
    change_note: z.string().trim().max(200).optional(),
  });
export type UpdateSkillInput = z.infer<typeof UpdateSkillInput>;

export const SkillVersion = z.object({
  version: z.number().int(),
  body: z.string(),
  message: z.string(),
  created_at: z.string(),
  current: z.boolean(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

export const SkillStats = z.object({
  used_by: z.array(z.object({ agent_id: z.string(), name: z.string(), enabled: z.boolean() })),
  /** Share of recent runs (30d) of bound agents that had this skill in the prompt. */
  pull_rate: z.number().min(0).max(1).nullable(),
  /** accepted / (accepted + dismissed) over findings of those runs. */
  accept_rate: z.number().min(0).max(1).nullable(),
  findings_30d: z.number().int(),
  findings_by_category: z.array(z.object({ category: z.string(), count: z.number().int() })),
});
export type SkillStats = z.infer<typeof SkillStats>;

export const SkillImportRequest = z.object({
  filename: z.string().min(1).max(200),
  /** File bytes, base64 (the API client only speaks JSON). */
  content_base64: z.string().min(1),
});
export type SkillImportRequest = z.infer<typeof SkillImportRequest>;

export const SkillImportUrlRequest = z.object({
  /** https URL of a raw .md / .zip (a github.com blob link is rewritten to raw). Fetched server-side. */
  url: z.string().trim().url().max(2000),
});
export type SkillImportUrlRequest = z.infer<typeof SkillImportUrlRequest>;

export const IgnoredFileReason = z.enum(['executable', 'not_core', 'binary', 'too_large']);
export type IgnoredFileReason = z.infer<typeof IgnoredFileReason>;

export const SkillImportPreview = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  body: z.string(),
  source_file: z.string(),
  /** Archive entries that were NOT read — listed only, never extracted or run. */
  ignored_files: z.array(z.object({ path: z.string(), reason: IgnoredFileReason })),
  warnings: z.array(z.string()),
  name_conflict: z.boolean(),
  /** Pattern scan of `body` — the skill will be saved blocked when this is `injection`. */
  scan: SkillScan,
});
export type SkillImportPreview = z.infer<typeof SkillImportPreview>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// ---- Conventions ----
export const ConventionCategory = z.enum([
  'NAMING',
  'STRUCTURE',
  'ERROR_HANDLING',
  'ASYNC',
  'TYPING',
  'IMPORTS',
  'TESTING',
  'STYLE',
  'OTHER',
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

/**
 * A new candidate starts PENDING until the user accepts or rejects it; only
 * ACCEPTED rules go into the skill, and REJECTED ones are left out of the list.
 */
export const ConventionStatus = z.enum(['PENDING', 'ACCEPTED', 'REJECTED']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

/**
 * A house rule found in the repo. The evidence was verified by code against the
 * file: `evidence_snippet` is sliced from the file at the verified lines, never
 * copied from the model's reply.
 */
export const ConventionCandidate = z.object({
  id: z.string(),
  repo_id: z.string(),
  category: ConventionCategory,
  rule: z.string(),
  evidence_path: z.string(),
  evidence_start_line: z.number().int().min(1),
  evidence_end_line: z.number().int().min(1),
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1),
  status: ConventionStatus,
  created_at: z.string(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

/** Accept / reject / inline edit of one candidate. */
export const UpdateConventionInput = z
  .object({
    rule: z.string().trim().min(1).max(500),
    category: ConventionCategory,
    status: ConventionStatus,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateConventionInput = z.infer<typeof UpdateConventionInput>;

/** Set one status on many candidates of a repo ("Deselect all" → PENDING). */
export const BulkConventionStatusInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  status: ConventionStatus,
});
export type BulkConventionStatusInput = z.infer<typeof BulkConventionStatusInput>;

export const ExtractConventionsResult = z.object({
  /** Every candidate of the repo after the scan (old + newly added). */
  candidates: z.array(ConventionCandidate),
  stats: z.object({
    sampled_files: z.number().int(),
    /** What the model returned. */
    proposed: z.number().int(),
    /** Evidence not found in the cited file — dropped by the code gate. */
    dropped_ungrounded: z.number().int(),
    /** Same rule already on the list (accepted or rejected). */
    dropped_duplicate: z.number().int(),
  }),
  model: z.string(),
  cost_usd: z.number().nullable(),
});
export type ExtractConventionsResult = z.infer<typeof ExtractConventionsResult>;

/** The skill the ACCEPTED candidates merge into. Built by the server, persists nothing. */
export const ConventionSkillDraft = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  enabled: z.boolean(),
  body: z.string(),
  accepted_count: z.number().int(),
  /** Set when a skill with `name` exists — saving then writes its next version. */
  existing_skill: z.object({ id: z.string(), version: z.number().int() }).nullable(),
});
export type ConventionSkillDraft = z.infer<typeof ConventionSkillDraft>;

/** Save the (edited) draft as a skill and link it to `agent_id`. */
export const CreateConventionSkillInput = CreateSkillInput.omit({ source: true }).extend({
  agent_id: z.string().uuid(),
});
export type CreateConventionSkillInput = z.infer<typeof CreateConventionSkillInput>;

// ---- Agents ----
// 'openrouter' routes through the OpenAI-compatible API (OpenAIProvider with a
// custom baseURL) — used by the CI runner for cheap models (DeepSeek/GLM/MiniMax).
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a review should BLOCK (REQUEST_CHANGES + fail the check)
// vs just comment. Deterministic from finding severities, NOT the model's verdict:
//  - never:    never block, always comment (advisory only)
//  - critical: block iff >=1 CRITICAL finding (default)
//  - warning:  block iff >=1 WARNING or CRITICAL finding
//  - any:      block iff >=1 finding of any severity
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
});
export type Agent = z.infer<typeof Agent>;

/** Agent + the rollup shown on the list tile: skills enabled for this agent. */
export const AgentListItem = Agent.extend({
  skill_count: z.number().int(),
});
export type AgentListItem = z.infer<typeof AgentListItem>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
  /** Enabled for THIS agent (the skill's own `enabled` is the global switch). */
  enabled: z.boolean(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

/** Replace an agent's skill list; array order = order in the prompt. */
export const SetAgentSkillsInput = z.object({
  skills: z.array(z.object({ skill_id: z.string().uuid(), enabled: z.boolean() })).max(50),
});
export type SetAgentSkillsInput = z.infer<typeof SetAgentSkillsInput>;

// The immutable config snapshot captured in `agent_versions` whenever an agent's
// config changes (everything but `enabled`). Mirrors the shape written by the
// agents repository — provider/model/prompt/output_schema/strategy/gate/repo_intel
// plus the ordered ids of skills enabled for the agent at snapshot time. Used for reproducibility
// (eval replays a past version) and for surfacing an agent's edit history.
export const AgentVersionConfig = z.object({
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  strategy: ReviewStrategy,
  ci_fail_on: CiFailOn,
  repo_intel: z.boolean(),
  skills: z.array(z.string()),
});
export type AgentVersionConfig = z.infer<typeof AgentVersionConfig>;

export const AgentVersion = z.object({
  agent_id: z.string(),
  version: z.number().int(),
  config: AgentVersionConfig,
  created_at: z.string(),
});
export type AgentVersion = z.infer<typeof AgentVersion>;
