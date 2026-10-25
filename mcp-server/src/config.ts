/**
 * Read once at startup. Holds no secrets — the MCP server never sees provider
 * keys or the GitHub token; the API resolves those itself.
 */
export const config = {
  /** Base URL of the DevDigest API (started separately with ./scripts/dev.sh). */
  apiUrl: (process.env['DEVDIGEST_API_URL'] ?? 'http://localhost:3001').replace(/\/+$/, ''),
  /** Delay between polls of a review run. */
  pollIntervalMs: 2_000,
  /**
   * How long run_agent_on_pr waits before answering {status:"running"}. Kept
   * under MCP_TOOL_TIMEOUT (150 s, .claude/settings.json) so the reply lands
   * before Claude Code aborts the call.
   */
  runTimeoutMs: 120_000,
} as const;
