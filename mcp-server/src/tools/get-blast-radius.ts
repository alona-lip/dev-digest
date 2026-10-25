import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DevDigestClient } from '../http/client.js';
import { getBlast } from '../core/blast.js';
import { apiFailure, toolError, toolOk } from '../format.js';
import { prArg, READ_ONLY, repoArg } from './shared.js';

export function registerGetBlastRadius(server: McpServer, client: DevDigestClient): void {
  server.registerTool(
    'get_blast_radius',
    {
      title: 'Blast radius of a PR',
      description:
        'Before reviewing or merging a PR, learn what else it touches: the symbols it changes, who calls them, ' +
        'and which HTTP endpoints and cron jobs are reached through those callers. ' +
        "Reads DevDigest's prebuilt code index only (no LLM, no new run). " +
        'If degraded is true, tell the user the reason and that the map may be incomplete.',
      inputSchema: { repo: repoArg, pr: prArg },
      annotations: READ_ONLY,
    },
    async ({ repo, pr }) => {
      try {
        const r = await getBlast(client, repo, pr);
        return 'error' in r ? toolError(r.error) : toolOk(r);
      } catch (err) {
        return apiFailure(err, client.apiUrl, `reading blast radius of ${repo}#${pr}`);
      }
    },
  );
}
