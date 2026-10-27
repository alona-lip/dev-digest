/**
 * Composition root — the only place that builds and wires dependencies.
 * stdout belongs to JSON-RPC; everything else goes through `log` (stderr).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { log } from './log.js';
import { createClient } from './http/client.js';
import { registerListAgents } from './tools/list-agents.js';
import { registerRunAgentOnPr } from './tools/run-agent-on-pr.js';
import { registerGetFindings } from './tools/get-findings.js';
import { registerGetConventions } from './tools/get-conventions.js';
import { registerGetBlastRadius } from './tools/get-blast-radius.js';

async function main(): Promise<void> {
  const server = new McpServer({ name: 'devdigest', version: '0.1.0' });
  const client = createClient(config.apiUrl);

  registerListAgents(server, client);
  registerRunAgentOnPr(server, client);
  registerGetFindings(server, client);
  registerGetConventions(server, client);
  registerGetBlastRadius(server, client);

  await server.connect(new StdioServerTransport());
  log.info('devdigest MCP server ready on stdio', { apiUrl: config.apiUrl });
}

main().catch((err: unknown) => {
  log.error('devdigest MCP server failed to start', String(err));
  process.exit(1);
});
