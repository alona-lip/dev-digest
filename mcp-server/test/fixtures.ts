import type {
  AgentListItem,
  FindingRecord,
  PrMeta,
  Repo,
  ReviewRecord,
  RunSummary,
} from '@devdigest/shared';
import type { DevDigestClient } from '../src/http/client.js';

/** Every method rejects unless the test overrides it — no accidental calls. */
export function fakeClient(overrides: Partial<DevDigestClient> = {}): DevDigestClient {
  const unexpected = (name: string) => () => Promise.reject(new Error(`unexpected call: ${name}`));
  return {
    apiUrl: 'http://api.test',
    listAgents: unexpected('listAgents'),
    listRepos: unexpected('listRepos'),
    listPulls: unexpected('listPulls'),
    triggerReview: unexpected('triggerReview'),
    listRuns: unexpected('listRuns'),
    listReviews: unexpected('listReviews'),
    listConventions: unexpected('listConventions'),
    getBlastRadius: unexpected('getBlastRadius'),
    ...overrides,
  };
}

export function repo(owner: string, name: string, id = `repo-${owner}-${name}`): Repo {
  return {
    id,
    workspace_id: 'ws',
    owner,
    name,
    full_name: `${owner}/${name}`,
    default_branch: 'main',
    clone_path: null,
    last_polled_at: null,
    created_by: null,
  };
}

export function pull(number: number, id: string | null = `pull-${number}`): PrMeta {
  return {
    id,
    number,
    title: `PR ${number}`,
    author: 'dev',
    branch: 'feat',
    base: 'main',
    head_sha: 'abc',
    additions: 1,
    deletions: 0,
    files_count: 1,
    status: 'open',
  };
}

export function agent(id: string, name: string, enabled = true): AgentListItem {
  return {
    id,
    name,
    description: '',
    provider: 'openai',
    model: 'gpt-4o-mini',
    system_prompt: 'SECRET PROMPT',
    enabled,
    version: 1,
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    repo_intel: true,
    skill_count: 0,
  };
}

export function finding(severity: FindingRecord['severity'], title: string, line = 1): FindingRecord {
  return {
    id: `f-${title}`,
    severity,
    category: 'security',
    title,
    file: 'src/app.ts',
    start_line: line,
    end_line: line + 2,
    rationale: `why ${title}`,
    suggestion: null,
    confidence: 0.9,
    review_id: 'rev',
    accepted_at: null,
    dismissed_at: null,
  };
}

export function review(over: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: 'rev',
    pr_id: 'pull-3',
    agent_id: 'a-sec',
    run_id: 'run-1',
    agent_name: 'Security Reviewer',
    kind: 'review',
    verdict: 'request_changes',
    summary: 'one critical issue',
    score: 40,
    model: 'gpt-4o-mini',
    created_at: '2026-10-24T10:00:00.000Z',
    findings: [],
    ...over,
  };
}

export function runSummary(run_id: string, status: string | null, error: string | null = null): RunSummary {
  return {
    run_id,
    agent_id: 'a-sec',
    agent_name: 'Security Reviewer',
    provider: 'openai',
    model: 'gpt-4o-mini',
    status,
    error,
    duration_ms: null,
    tokens_in: null,
    tokens_out: null,
    cost_usd: null,
    findings_count: null,
    grounding: null,
    ran_at: null,
    score: null,
    blockers: null,
  };
}
