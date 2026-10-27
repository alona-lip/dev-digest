#!/usr/bin/env node
/**
 * One MCP tool call without a UI: spawns the server over stdio, does the
 * handshake, calls the tool, prints the result, exits (1 on isError).
 *
 *   pnpm call                                   # list tools with their annotations
 *   pnpm call list_agents
 *   pnpm call run_agent_on_pr '{"repo":"owner/name","pr":3,"agent":"<id>"}'
 *
 * Needs the API (./scripts/dev.sh). Honors DEVDIGEST_API_URL.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const [tool, rawArgs] = process.argv.slice(2);
let args = {};
if (rawArgs) {
  try {
    args = JSON.parse(rawArgs);
  } catch {
    console.error('second argument must be JSON, e.g. \'{"repo":"owner/name"}\'');
    process.exit(2);
  }
}

/** Our tools answer JSON; the SDK's own errors (e.g. input validation) are plain text. */
function pretty(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const transport = new StdioClientTransport({
  command: resolve(root, 'node_modules/.bin/tsx'),
  args: [resolve(root, 'src/index.ts')],
  cwd: root,
  env: { ...process.env },
  stderr: 'inherit',
});
const client = new Client({ name: 'devdigest-call', version: '0.1.0' });
await client.connect(transport);

try {
  if (!tool) {
    const { tools } = await client.listTools();
    for (const t of tools) {
      console.log(`${t.name}  ${JSON.stringify(t.annotations)}\n  args: ${Object.keys(t.inputSchema.properties ?? {}).join(', ') || '—'}`);
    }
  } else {
    // Long reviews: wait past the 120 s in-tool limit, like MCP_TOOL_TIMEOUT does in Claude Code.
    const result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 150_000 });
    for (const part of result.content) {
      console.log(part.type === 'text' ? pretty(part.text) : part);
    }
    if (result.isError) process.exitCode = 1;
  }
} finally {
  await client.close();
}
