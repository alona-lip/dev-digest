import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRepoUrl, canonicalCloneUrl } from '../src/modules/repos/helpers.js';
import { SimpleGitClient, stripUrlCredentials } from '../src/adapters/git/simple-git.js';
import { redactCredentials } from '../src/platform/jobs.js';

/**
 * The repo URL is user input that ends up as a path under the clone dir — and
 * `clone()` may `rm -rf` that path. These pin what is accepted, what is
 * refused, and that nothing user-supplied reaches git or disk unfiltered.
 */
describe('parseRepoUrl', () => {
  it.each([
    ['https://github.com/acme/payments-api', 'acme', 'payments-api'],
    ['https://github.com/acme/payments-api.git', 'acme', 'payments-api'],
    ['https://github.com/acme/payments-api/', 'acme', 'payments-api'],
    ['git@github.com:acme/payments-api.git', 'acme', 'payments-api'],
    ['github.com/acme/payments-api', 'acme', 'payments-api'],
    ['https://www.github.com/acme/payments-api', 'acme', 'payments-api'],
    ['  https://github.com/acme/payments-api  ', 'acme', 'payments-api'],
    // Dotted names used to be rejected.
    ['https://github.com/vercel/next.js', 'vercel', 'next.js'],
    ['https://github.com/vercel/next.js.git', 'vercel', 'next.js'],
    ['https://github.com/a-b/c_d.e-f', 'a-b', 'c_d.e-f'],
  ])('accepts %s', (url, owner, name) => {
    expect(parseRepoUrl(url)).toEqual({ owner, name });
  });

  it.each([
    'https://x.io/github.com/../workspace',
    'https://github.com/../workspace',
    'https://github.com/acme/..',
    'https://github.com/acme/.',
    'https://evil.example/github.com/acme/repo',
    'file:///etc/github.com/acme/repo',
    'https://github.com/acme',
    'https://github.com/acme/repo/tree/main',
    'https://github.com/-acme/repo',
    'not a url',
  ])('rejects %s with a 400', (url) => {
    expect(() => parseRepoUrl(url)).toThrowError(expect.objectContaining({ statusCode: 400 }));
  });

  it('builds the clone URL from the parsed parts only', () => {
    expect(canonicalCloneUrl('vercel', 'next.js')).toBe('https://github.com/vercel/next.js.git');
  });
});

describe('SimpleGitClient.clonePathFor', () => {
  const root = join(tmpdir(), 'devdigest-clone-root');
  const git = new SimpleGitClient(root);

  it('resolves inside the clone dir', () => {
    expect(git.clonePathFor({ owner: 'acme', name: 'api' })).toBe(join(root, 'acme', 'api'));
  });

  it.each([
    { owner: '..', name: 'x' },
    { owner: 'acme', name: '..' },
    { owner: '.', name: '.' },
    { owner: '../..', name: 'etc' },
  ])('refuses %o, which would escape the clone dir', (repo) => {
    expect(() => git.clonePathFor(repo)).toThrow(/outside the clone dir/);
  });
});

describe('credential scrubbing', () => {
  it('stripUrlCredentials drops user:token from an https remote', () => {
    expect(stripUrlCredentials('https://x-access-token:ghp_secret@github.com/acme/api.git')).toBe(
      'https://github.com/acme/api.git',
    );
    expect(stripUrlCredentials('https://github.com/acme/api.git')).toBe(
      'https://github.com/acme/api.git',
    );
    expect(stripUrlCredentials('git@github.com:acme/api.git')).toBe('git@github.com:acme/api.git');
  });

  it('redactCredentials removes tokens from a persisted job error', () => {
    const msg =
      "fatal: unable to access 'https://x-access-token:ghp_secret@github.com/acme/api.git/': " +
      'Authorization: Basic eC1hY2Nlc3MtdG9rZW46Z2hwX3NlY3JldA== rejected';
    const out = redactCredentials(msg);
    expect(out).not.toContain('ghp_secret');
    expect(out).not.toContain('eC1hY2Nlc3MtdG9rZW46Z2hwX3NlY3JldA==');
    expect(out).toContain('github.com/acme/api.git');
  });
});
