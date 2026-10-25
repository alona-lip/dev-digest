import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConventionStatus } from '@devdigest/shared';
import type { DevDigestClient } from '../http/client.js';
import { resolveRepo } from '../core/resolve.js';
import { apiFailure, compactConvention, toolError, toolOk } from '../format.js';
import { READ_ONLY, repoArg } from './shared.js';

/**
 * ACCEPTED first — they are the confirmed house rules. REJECTED never comes
 * back from the API; it is listed so a new contract status fails to compile.
 */
const STATUS_RANK: Record<ConventionStatus, number> = { ACCEPTED: 0, PENDING: 1, REJECTED: 2 };

export function registerGetConventions(server: McpServer, client: DevDigestClient): void {
  server.registerTool(
    'get_conventions',
    {
      title: "Get a repo's house conventions",
      description:
        "Get the coding conventions DevDigest extracted from a repository (rule, category, status, evidence file, confidence). " +
        "Use it to check or justify a finding against the repo's own house rules. " +
        'Only status ACCEPTED rules are confirmed by a human; PENDING ones are unreviewed candidates — do not cite them as rules. ' +
        'An empty list means no scan was run yet (Studio → Conventions).',
      inputSchema: { repo: repoArg },
      annotations: READ_ONLY,
    },
    async ({ repo }) => {
      try {
        const ref = await resolveRepo(client, repo);
        if ('error' in ref) return toolError(ref.error);

        const conventions = (await client.listConventions(ref.repoId))
          .map(compactConvention)
          .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
        return toolOk({ repo: ref.fullName, conventions });
      } catch (err) {
        return apiFailure(err, client.apiUrl, `reading conventions of ${repo}`);
      }
    },
  );
}
