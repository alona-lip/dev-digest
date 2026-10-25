/**
 * Response shaping — pure. The MCP result envelope, the compact projections
 * that keep tool output small (no UUIDs of repos/PRs, no prompts, no
 * evidence snippets), and the forward-leading text for API failures.
 */
import type {
  AgentListItem,
  ConventionCandidate,
  Finding,
  FindingRecord,
} from '@devdigest/shared';
import { ApiError } from './http/client.js';

export type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: true;
};

export function toolOk(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

/** A business failure the model can act on — `message` says what to do next. */
export function toolError(message: string): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

// ---- Compact projections --------------------------------------------------

export type CompactAgent = Pick<AgentListItem, 'id' | 'name' | 'enabled' | 'model'>;

export function compactAgent(a: AgentListItem): CompactAgent {
  return { id: a.id, name: a.name, enabled: a.enabled, model: a.model };
}

/** `line` = start_line: one clean file:line signal per finding. */
export type CompactFinding = Pick<Finding, 'severity' | 'title' | 'file' | 'rationale'> & {
  line: number;
};

export function compactFinding(f: Finding): CompactFinding {
  return { severity: f.severity, title: f.title, file: f.file, line: f.start_line, rationale: f.rationale };
}

export type DetailedFinding = CompactFinding &
  Pick<Finding, 'id' | 'category' | 'end_line' | 'confidence'> & { suggestion: string | null };

export function detailedFinding(f: FindingRecord): DetailedFinding {
  return {
    ...compactFinding(f),
    id: f.id,
    category: f.category,
    end_line: f.end_line,
    confidence: f.confidence,
    suggestion: f.suggestion ?? null,
  };
}

export type CompactConvention = Pick<ConventionCandidate, 'rule' | 'category' | 'status' | 'confidence'> & {
  file: string;
};

export function compactConvention(c: ConventionCandidate): CompactConvention {
  return { rule: c.rule, category: c.category, status: c.status, file: c.evidence_path, confidence: c.confidence };
}

// ---- API failures ----------------------------------------------------------

/**
 * Turn a thrown error into a next step. `what` names the call that failed
 * ("listing agents"). Only status 0 means the API is down — a 404/429 from a
 * running API must not tell the model to go start it.
 */
export function apiFailure(err: unknown, apiUrl: string, what: string): ToolResult {
  if (!(err instanceof ApiError)) {
    return toolError(`Unexpected error while ${what}: ${String(err)}`);
  }
  if (err.status === 0) {
    return toolError(`DevDigest API unreachable at ${apiUrl} — start it with ./scripts/dev.sh, then retry.`);
  }
  if (err.status === 429) {
    return toolError(
      'DevDigest rate limit hit (10 review runs per minute). Wait a minute, then retry — do not loop.',
    );
  }
  if (err.status === 404) {
    return toolError(`Not found while ${what}: ${err.message}. Re-resolve ids with list_agents or check repo/pr.`);
  }
  return toolError(`DevDigest API error ${err.status} while ${what}: ${err.message}`);
}
