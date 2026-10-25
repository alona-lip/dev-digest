/**
 * The ONLY place that talks to the DevDigest API. Its method list IS the MCP
 * server's permission boundary: reads, plus one write (trigger a review). No
 * delete / update / settings / secrets call exists here, so no tool can make
 * one. Response types come from @devdigest/shared (type-only — erased at
 * runtime); endpoints return bare shapes, no { data } envelope.
 */
import type {
  AgentListItem,
  ConventionCandidate,
  PrBlastRadius,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  RunSummary,
} from '@devdigest/shared';

/**
 * Non-2xx answer or network failure. `status` 0 = the API was not reached at
 * all; `message` is the server's own `error.message` when it sent one.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface DevDigestClient {
  /** Base URL, for error messages. */
  readonly apiUrl: string;
  listAgents(): Promise<AgentListItem[]>;
  listRepos(): Promise<Repo[]>;
  listPulls(repoId: string): Promise<PrMeta[]>;
  triggerReview(pullId: string, agentId: string): Promise<ReviewRunResponse>;
  listRuns(pullId: string): Promise<RunSummary[]>;
  listReviews(pullId: string): Promise<ReviewRecord[]>;
  listConventions(repoId: string): Promise<ConventionCandidate[]>;
  getBlastRadius(pullId: string): Promise<PrBlastRadius>;
}

/** `{ error: { message } }` → message; anything else → the raw body (trimmed). */
function serverMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === 'string') return parsed.error.message;
  } catch {
    // not JSON — fall through
  }
  return body.slice(0, 300);
}

export function createClient(apiUrl: string): DevDigestClient {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${apiUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      });
    } catch (cause) {
      throw new ApiError(0, url, `Network error reaching ${url}: ${String(cause)}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ApiError(res.status, url, serverMessage(body) || `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  const id = encodeURIComponent;

  return {
    apiUrl,
    listAgents: () => request('/agents'),
    listRepos: () => request('/repos'),
    listPulls: (repoId) => request(`/repos/${id(repoId)}/pulls`),
    triggerReview: (pullId, agentId) =>
      request(`/pulls/${id(pullId)}/review`, {
        method: 'POST',
        body: JSON.stringify({ agentId }),
      }),
    listRuns: (pullId) => request(`/pulls/${id(pullId)}/runs`),
    listReviews: (pullId) => request(`/pulls/${id(pullId)}/reviews`),
    listConventions: (repoId) => request(`/repos/${id(repoId)}/conventions`),
    getBlastRadius: (pullId) => request(`/pulls/${id(pullId)}/blast`),
  };
}
