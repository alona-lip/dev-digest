/**
 * Honest STUB — the real blast radius is the Lab 4 homework. It makes no I/O
 * and answers a well-formed non-error result, so a model notes the gap and
 * moves on instead of treating it as a failure to work around.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toolOk } from '../format.js';
import { prArg, READ_ONLY, repoArg } from './shared.js';

export function registerGetBlastRadius(server: McpServer): void {
  server.registerTool(
    'get_blast_radius',
    {
      title: 'Blast radius of a PR (not implemented)',
      description:
        "NOT IMPLEMENTED YET — returns a placeholder, never real data. Will map which symbols a PR changes and who calls them. " +
        'Do not block on it: say blast radius is unavailable and continue.',
      inputSchema: { repo: repoArg.optional(), pr: prArg.optional() },
      annotations: READ_ONLY,
    },
    async () =>
      toolOk({
        status: 'not_implemented',
        message: 'Blast radius is not available yet in DevDigest. Continue without it and mention the gap.',
      }),
  );
}
