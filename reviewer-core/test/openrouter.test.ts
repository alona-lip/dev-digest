/**
 * OpenRouterProvider against a local OpenAI-compatible stub (no network):
 *  - cost null-poisoning across repair attempts (reviewer-core/INSIGHTS.md);
 *  - the per-request timeout is honoured.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Review } from '@devdigest/shared';
import { OpenRouterProvider } from '../src/llm/openrouter.js';

const VALID = JSON.stringify({ verdict: 'approve', score: 100, summary: 'ok', findings: [] });

type Reply = { content: string; cost?: number; delayMs?: number };

let server: Server | undefined;

/** Serves one canned chat completion per request, in order. */
async function stub(replies: Reply[]): Promise<string> {
  let i = 0;
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const r = replies[Math.min(i++, replies.length - 1)]!;
      const send = () => {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: `c${i}`,
            object: 'chat.completion',
            created: 0,
            model: 'm',
            choices: [{ index: 0, message: { role: 'assistant', content: r.content }, finish_reason: 'stop' }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 10,
              total_tokens: 110,
              ...(r.cost !== undefined ? { cost: r.cost } : {}),
            },
          }),
        );
      };
      if (r.delayMs) setTimeout(send, r.delayMs);
      else send();
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

const request = {
  model: 'm',
  schema: Review,
  schemaName: 'Review',
  messages: [{ role: 'user' as const, content: 'review' }],
  maxRetries: 2,
};

describe('OpenRouterProvider.completeStructured', () => {
  it('uses the provider cost when every attempt reported one', async () => {
    const baseURL = await stub([{ content: 'not json', cost: 0.01 }, { content: VALID, cost: 0.02 }]);
    const p = new OpenRouterProvider('k', { baseURL, maxRetries: 0, estimateCost: () => 99 });
    const res = await p.completeStructured(request);
    expect(res.attempts).toBe(2);
    expect(res.costUsd).toBeCloseTo(0.03);
  });

  it('falls back to the estimate over ALL tokens when one attempt had no cost', async () => {
    const baseURL = await stub([{ content: 'not json', cost: 0.01 }, { content: VALID }]);
    const seen: number[] = [];
    const p = new OpenRouterProvider('k', {
      baseURL,
      maxRetries: 0,
      estimateCost: (_m, tokensIn) => {
        seen.push(tokensIn);
        return 0.5;
      },
    });
    const res = await p.completeStructured(request);
    // Not the partial 0.01 — the estimate, computed over both attempts' tokens.
    expect(res.costUsd).toBe(0.5);
    expect(seen).toEqual([200]);
  });

  it('honours the per-request timeout', async () => {
    const baseURL = await stub([{ content: VALID, delayMs: 2_000 }]);
    const p = new OpenRouterProvider('k', { baseURL, maxRetries: 0 });
    await expect(p.completeStructured({ ...request, timeoutMs: 100 })).rejects.toThrow(/timed out/i);
  });
});
