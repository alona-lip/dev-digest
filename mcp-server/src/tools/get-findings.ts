import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DevDigestClient } from '../http/client.js';
import { resolvePull } from '../core/resolve.js';
import { loadReview, shapeFindings } from '../core/findings.js';
import { apiFailure, toolError, toolOk } from '../format.js';
import { prArg, READ_ONLY, repoArg } from './shared.js';

const DEFAULT_LIMIT = { concise: 10, detailed: 20 } as const;

const inputSchema = {
  repo: repoArg,
  pr: prArg,
  run_id: z
    .string()
    .min(1)
    .optional()
    .describe('Optional: the run_id returned by run_agent_on_pr. Omit for the latest review of the PR.'),
  response_format: z
    .enum(['concise', 'detailed'])
    .default('concise')
    .describe("'concise' (default): severity, title, file, line, rationale. 'detailed': adds id, category, end_line, confidence, suggestion."),
  offset: z.number().int().min(0).default(0).describe('Skip this many findings (worst first). Default 0.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Max findings to return. Default 10 (concise) / 20 (detailed).'),
};

export function registerGetFindings(server: McpServer, client: DevDigestClient): void {
  server.registerTool(
    'get_findings',
    {
      title: 'Get findings of a DevDigest review',
      description:
        "Get the verdict and findings of a review DevDigest already ran on a PR — without starting a new run. " +
        "Use it after run_agent_on_pr returned status:'running', to page past the first 20 findings, or to read an existing review. " +
        'Returns counts by severity over all findings plus one page, worst first.',
      inputSchema,
      annotations: READ_ONLY,
    },
    async ({ repo, pr, run_id, response_format, offset, limit }) => {
      try {
        const pull = await resolvePull(client, repo, pr);
        if ('error' in pull) return toolError(pull.error);

        const loaded = await loadReview(client, pull.pullId, run_id);
        if (loaded.kind === 'missing') return toolError(loaded.error);
        if (loaded.kind === 'running') {
          return toolOk({
            status: 'running',
            run_id: loaded.run_id,
            next: 'Not finished yet — call get_findings again in a minute with the same arguments.',
          });
        }

        return toolOk({
          repo: pull.fullName,
          pr,
          ...shapeFindings(loaded.review, {
            format: response_format,
            offset,
            limit: limit ?? DEFAULT_LIMIT[response_format],
          }),
        });
      } catch (err) {
        return apiFailure(err, client.apiUrl, `reading findings of ${repo}#${pr}`);
      }
    },
  );
}
