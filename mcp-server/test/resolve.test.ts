import { describe, expect, it } from 'vitest';
import { resolveAgent, resolvePull, resolveRepo } from '../src/core/resolve.js';
import { agent, fakeClient, pull, repo } from './fixtures.js';

const repos = [repo('octo', 'hello'), repo('acme', 'api'), repo('other', 'api')];

describe('resolveRepo', () => {
  const client = fakeClient({ listRepos: async () => repos });

  it('matches owner/name case-insensitively', async () => {
    expect(await resolveRepo(client, 'OCTO/Hello')).toEqual({ repoId: 'repo-octo-hello', fullName: 'octo/hello' });
  });

  it('accepts a bare name that only one repo has', async () => {
    expect(await resolveRepo(client, 'hello')).toEqual({ repoId: 'repo-octo-hello', fullName: 'octo/hello' });
  });

  it('asks for owner/name when a bare name is ambiguous', async () => {
    const res = await resolveRepo(client, 'api');
    expect(res).toEqual({ error: expect.stringContaining('ambiguous: acme/api, other/api') });
  });

  it('lists connected repos when nothing matches', async () => {
    const res = await resolveRepo(client, 'nope/nope');
    expect('error' in res && res.error).toContain('Connected: octo/hello, acme/api, other/api');
  });

  it('says how to connect one when there are no repos', async () => {
    const res = await resolveRepo(fakeClient({ listRepos: async () => [] }), 'x');
    expect('error' in res && res.error).toContain('No repositories are connected');
  });
});

describe('resolvePull', () => {
  const pulls = [pull(1), pull(2, null), pull(3)];
  const client = fakeClient({ listRepos: async () => repos, listPulls: async () => pulls });

  it('maps a PR number to its pull id', async () => {
    expect(await resolvePull(client, 'octo/hello', 3)).toEqual({
      repoId: 'repo-octo-hello',
      fullName: 'octo/hello',
      pullId: 'pull-3',
    });
  });

  it('treats a PR without a persisted id as not found and points to gh', async () => {
    const res = await resolvePull(client, 'octo/hello', 2);
    expect('error' in res && res.error).toContain('PR #2 not found in octo/hello. Known PRs: #1, #3.');
    expect('error' in res && res.error).toContain('gh pr list -R octo/hello');
  });

  it('passes a repo miss through without listing pulls', async () => {
    const res = await resolvePull(fakeClient({ listRepos: async () => repos }), 'ghost', 1);
    expect('error' in res && res.error).toContain("Repo 'ghost' is not connected");
  });
});

describe('resolveAgent', () => {
  const agents = [agent('a-gen', 'General Reviewer'), agent('a-sec', 'Security Reviewer', false)];

  it('matches by id first', () => {
    expect(resolveAgent(agents, 'a-sec')).toMatchObject({ id: 'a-sec' });
  });

  it('falls back to the exact name, any case — disabled agents included', () => {
    expect(resolveAgent(agents, 'security reviewer')).toMatchObject({ id: 'a-sec', enabled: false });
  });

  it('lists valid ids when nothing matches', () => {
    expect(resolveAgent(agents, 'Perf')).toEqual({
      error: expect.stringContaining('Call list_agents and pass an id from it. Available: a-gen (General Reviewer), a-sec (Security Reviewer).'),
    });
  });
});
