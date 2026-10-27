/** Argument fields and annotations shared by several tools — one wording each. */
import { z } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

export const repoArg = z
  .string()
  .min(1)
  .describe("Repository as 'owner/name' (e.g. 'octocat/hello'); a bare name works if only one connected repo has it.");

export const prArg = z
  .number()
  .int()
  .positive()
  .describe('Pull request number on GitHub (e.g. 3) — not an internal id.');

/** Reads DevDigest's own database only. */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
