import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DevDigestClient } from '../http/client.js';
import { config } from '../config.js';
import { resolveAgent, resolvePull } from '../core/resolve.js';
import { runReviewAndWait } from '../core/run-review.js';
import { shapeFindings } from '../core/findings.js';
import { apiFailure, toolError, toolOk } from '../format.js';
import { prArg, repoArg } from './shared.js';

/** Findings returned inline; the rest is paged through get_findings. */
const INLINE_LIMIT = 20;

const inputSchema = {
  repo: repoArg,
  pr: prArg,
  agent: z
    .string()
    .min(1)
    .describe("Agent id from list_agents (an exact agent name like 'Security Reviewer' also works). Do not guess ids."),
};

export function registerRunAgentOnPr(server: McpServer, client: DevDigestClient): void {
  server.registerTool(
    'run_agent_on_pr',
    {
      title: 'Run a DevDigest review on a PR',
      description:
        'Run ONE DevDigest reviewer agent on a pull request and return its real verdict and findings ' +
        '(worst first, up to 20, with counts by severity). A single call: it starts the review and waits for it — do not poll. ' +
        'Get the agent id from list_agents first. Each call starts a new paid LLM run (limit 10/min) — do not retry in a loop. ' +
        "If the review takes over ~2 min it returns {status:'running', run_id}; then call get_findings with the same repo, pr and run_id.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ repo, pr, agent }) => {
      try {
        const pull = await resolvePull(client, repo, pr);
        if ('error' in pull) return toolError(pull.error);

        const picked = resolveAgent(await client.listAgents(), agent);
        if ('error' in picked) return toolError(picked.error);

        const outcome = await runReviewAndWait(client, { pullId: pull.pullId, agentId: picked.id }, config);

        if (outcome.kind === 'running') {
          return toolOk({
            status: 'running',
            run_id: outcome.run_id,
            repo: pull.fullName,
            pr,
            next: `Review still running. Call get_findings with repo '${pull.fullName}', pr ${pr}, run_id '${outcome.run_id}' in a minute.`,
          });
        }
        if (outcome.kind === 'failed') {
          const which = outcome.run_id ? `Review run ${outcome.run_id}` : 'Review';
          return toolError(`${which} of '${picked.name}' failed: ${outcome.error}. Fix the cause (see DevDigest Settings / run trace) before retrying.`);
        }

        const page = shapeFindings(outcome.review, { format: 'concise', offset: 0, limit: INLINE_LIMIT });
        return toolOk({
          repo: pull.fullName,
          pr,
          ...page,
          agent: picked.name,
          ...(page.total > page.returned
            ? { more: `Showing ${page.returned} of ${page.total}. Page the rest with get_findings (offset ${page.returned}).` }
            : {}),
        });
      } catch (err) {
        return apiFailure(err, client.apiUrl, `running agent '${agent}' on ${repo}#${pr}`);
      }
    },
  );
}
