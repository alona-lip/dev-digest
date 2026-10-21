import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';

/**
 * No-DB route smoke tests via app.inject(). `/health` and the validation/error
 * envelope don't touch the database (postgres-js connects lazily), so these run
 * without Docker. DB-backed routes are covered in integration.test.ts.
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

describe('routes (no DB)', () => {
  it('GET /health → ok', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('POST /settings/test-connection (github) returns structured ConnTestResult', async () => {
    const app = await buildApp({
      config,
      overrides: { github: new MockGitHubClient({ login: 'octocat' }) },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/test-connection',
      payload: { provider: 'github' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.provider).toBe('github');
    expect(body.ok).toBe(true);
    expect(body.message).toContain('octocat');
    await app.close();
  });

  it('POST /settings/test-connection (openai) uses injected LLM listModels', async () => {
    const app = await buildApp({
      config,
      overrides: {
        llm: { openai: new MockLLMProvider('openai', { models: [{ id: 'gpt-4.1', provider: 'openai' }] }) },
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/test-connection',
      payload: { provider: 'openai' },
    });
    expect(res.json().ok).toBe(true);
    await app.close();
  });

  describe('POST /settings/test-connection with a new key (test, then save)', () => {
    /** In-memory writable secrets backend, so the test can see what got persisted. */
    function memorySecrets(initial: Record<string, string>) {
      const store = { ...initial };
      return {
        store,
        provider: {
          get: async (k: string) => store[k],
          set: async (k: string, v: string) => {
            store[k] = v;
          },
        },
      };
    }
    const failingLlm = {
      id: 'openai',
      listModels: async () => {
        throw new Error('401 Incorrect API key provided');
      },
    } as unknown as MockLLMProvider;

    it('keeps the working key when the candidate fails the live test', async () => {
      const secrets = memorySecrets({ OPENAI_API_KEY: 'sk-good' });
      const app = await buildApp({
        config,
        overrides: { secrets: secrets.provider, llm: { openai: failingLlm } },
      });
      const res = await app.inject({
        method: 'POST',
        url: '/settings/test-connection',
        payload: { provider: 'openai', key: 'sk-typo' },
      });
      expect(res.json()).toMatchObject({ ok: false, message: expect.stringContaining('401') });
      expect(secrets.store.OPENAI_API_KEY).toBe('sk-good');
      await app.close();
    });

    it('saves the candidate once the live test passes', async () => {
      const secrets = memorySecrets({});
      const app = await buildApp({
        config,
        overrides: { secrets: secrets.provider, github: new MockGitHubClient({ login: 'octocat' }) },
      });
      const res = await app.inject({
        method: 'POST',
        url: '/settings/test-connection',
        payload: { provider: 'github', key: 'ghp_new' },
      });
      expect(res.json()).toMatchObject({ ok: true, message: 'Connected as @octocat' });
      expect(secrets.store.GITHUB_TOKEN).toBe('ghp_new');
      await app.close();
    });
  });

  it('a non-AppError 500 hides its message and names the request id', async () => {
    const app = await buildApp({ config });
    app.get('/boom', async () => {
      throw new Error('relation "secret_table" does not exist');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.message).not.toContain('secret_table');
    expect(res.json().error.message).toMatch(/^Internal error \(request .+\)$/);
    await app.close();
  });

  it('POST /pulls/:id/review: an empty body passes the route schema, a malformed one is a 422', async () => {
    const app = await buildApp({ config });
    const url = '/pulls/00000000-0000-0000-0000-000000000001/review';
    // No DB in this suite, so a VALID request fails later (not 422) — what
    // matters is that the schema let the empty body through.
    const empty = await app.inject({ method: 'POST', url });
    expect(empty.statusCode).not.toBe(422);
    const bad = await app.inject({ method: 'POST', url, payload: { all: 'yes' } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe('validation_error');
    await app.close();
  });

  it('returns 422 structured error on invalid body', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/test-connection',
      payload: { provider: 'not-a-provider' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });
});
