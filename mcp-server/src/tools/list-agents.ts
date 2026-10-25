import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DevDigestClient } from '../http/client.js';
import { apiFailure, compactAgent, toolOk } from '../format.js';
import { READ_ONLY } from './shared.js';

export function registerListAgents(server: McpServer, client: DevDigestClient): void {
  server.registerTool(
    'list_agents',
    {
      title: 'List DevDigest reviewer agents',
      description:
        'List the reviewer agents configured in DevDigest (id, name, model, enabled). ' +
        'Call this FIRST whenever you need an agent for run_agent_on_pr — pass an id from here, never a guessed one. ' +
        'Only DevDigest knows this configuration.',
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const agents = await client.listAgents();
        return toolOk({ agents: agents.map(compactAgent) });
      } catch (err) {
        return apiFailure(err, client.apiUrl, 'listing agents');
      }
    },
  );
}
