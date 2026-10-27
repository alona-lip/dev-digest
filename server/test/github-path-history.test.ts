import { describe, it, expect, vi } from 'vitest';
import { buildPathHistoryQuery, OctokitGitHubClient } from '../src/adapters/github/octokit.js';
import { ExternalServiceError } from '../src/platform/errors.js';

const REPO = { owner: 'acme', name: 'api' };

/** A real client whose `octokit.graphql` is replaced — no network. */
function clientWith(graphql: (...args: unknown[]) => Promise<unknown>) {
  const client = new OctokitGitHubClient('test-token');
  const fake = vi.fn(graphql);
  (client as unknown as { octokit: { graphql: typeof fake } }).octokit.graphql = fake;
  return { client, graphql: fake };
}

const pr = (number: number, mergedAt: string | null = '2026-10-01T00:00:00Z') => ({
  number,
  title: `PR ${number}`,
  mergedAt,
  author: { login: 'dev' },
});

describe('buildPathHistoryQuery', () => {
  it('declares one variable and one alias per path, and no path text', () => {
    const q = buildPathHistoryQuery(3);
    for (const i of [0, 1, 2]) {
      expect(q).toContain(`$p${i}: String!`);
      expect(q).toContain(`f${i}: history(first: $perPath, path: $p${i})`);
    }
    expect(q).not.toContain('$p3');
    expect(q).toContain('$owner: String!');
    expect(q).toContain('ref(qualifiedName: $ref)');
    expect(q).not.toMatch(/src\/|\.ts/);
  });
});

describe('OctokitGitHubClient.listPathPullRequests', () => {
  it('makes no call for zero paths', async () => {
    const { client, graphql } = clientWith(async () => ({}));
    expect(await client.listPathPullRequests(REPO, 'main', [], 10)).toEqual([]);
    expect(graphql).not.toHaveBeenCalled();
  });

  it('passes paths as variables and maps aliases back to paths, deduping PRs per path', async () => {
    const { client, graphql } = clientWith(async () => ({
      repository: {
        ref: {
          target: {
            f0: { nodes: [{ associatedPullRequests: { nodes: [pr(7)] } }, { associatedPullRequests: { nodes: [pr(7)] } }] },
            f1: { nodes: [{ associatedPullRequests: { nodes: [{ ...pr(9), author: null }] } }] },
          },
        },
      },
    }));
    const out = await client.listPathPullRequests(REPO, 'main', ['a.ts', 'b.ts'], 10);
    expect(graphql).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ owner: 'acme', name: 'api', ref: 'refs/heads/main', perPath: 10, p0: 'a.ts', p1: 'b.ts' }),
    );
    expect(out).toEqual([
      { path: 'a.ts', prs: [{ number: 7, title: 'PR 7', merged_at: '2026-10-01T00:00:00Z', author: 'dev' }] },
      { path: 'b.ts', prs: [{ number: 9, title: 'PR 9', merged_at: '2026-10-01T00:00:00Z', author: 'unknown' }] },
    ]);
  });

  it('fails (not an empty history) when the base ref does not exist', async () => {
    const { client, graphql } = clientWith(async () => ({ repository: { ref: null } }));
    const call = client.listPathPullRequests(REPO, 'gone', ['a.ts'], 10);
    await expect(call).rejects.toBeInstanceOf(ExternalServiceError);
    await expect(call).rejects.toThrow("branch 'gone' not found in acme/api");
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it('maps a GraphQL error to ExternalServiceError without retrying it', async () => {
    const { client, graphql } = clientWith(async () => {
      throw new Error("Could not resolve to a Repository with the name 'acme/api'.");
    });
    await expect(client.listPathPullRequests(REPO, 'main', ['a.ts'], 10)).rejects.toBeInstanceOf(ExternalServiceError);
    expect(graphql).toHaveBeenCalledTimes(1);
  });
});
