/** Whole model input (all messages) must stay within this many tiktoken tokens (AC-17). */
export const BRIEF_TOKEN_BUDGET = 8000;

/** Caps applied after post-validation (AC-36). */
export const MAX_RISKS = 8;
export const MAX_FOCUS = 8;

/** Near-deterministic: the brief summarises, it does not create. */
export const LLM_TEMPERATURE = 0.1;

/** Name of the JSON schema handed to the provider for structured output. */
export const BRIEF_SCHEMA_NAME = 'BriefModelOutput';

/** Appended to a shortened issue / description text (AC-18). */
export const TRIM_MARKER = '\n…[truncated]';
