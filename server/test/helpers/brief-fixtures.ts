import fs from 'node:fs';
import { vi } from 'vitest';
import type { z } from 'zod';
import { parseUnifiedDiff } from '@devdigest/shared';
import type {
  PrDetail,
  PrFile,
  RepoRef,
  StructuredRequest,
  StructuredResult,
  UnifiedDiff,
} from '@devdigest/shared';
import * as t from '../../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../../src/adapters/mocks.js';
import type { PgFixture } from './pg.js';

type TestDb = PgFixture['handle']['db'];

/** Unified diff of one file with a single hunk starting at `newStart` (new side covers `newStart..newStart+3`). */
export function fileDiff(path: string, newStart = 10): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${newStart},3 +${newStart},4 @@`,
    ' context-one',
    '+added-line',
    ' context-two',
    ' context-three',
  ].join('\n');
}

/** A raw unified diff of `paths`, each with one hunk at lines 10-13. */
export const diffOf = (...paths: string[]): string => paths.map((p) => fileDiff(p)).join('\n');

/** Git whose `diff()` returns whatever `raw` currently holds ('' = no local diff). */
export class SwitchableGit extends MockGitClient {
  raw = '';
  override async diff(): Promise<UnifiedDiff> {
    return parseUnifiedDiff(this.raw);
  }
}

/** GitHub mock whose PR file list (the fallback of the changed-files resolution) is settable. */
export class FakeGitHub extends MockGitHubClient {
  files: PrFile[] = [];
  override async getPullRequest(repo: RepoRef, n: number): Promise<PrDetail> {
    return { ...(await super.getPullRequest(repo, n)), files: this.files };
  }
}

/** Wrap an object so every method call increments a counter (properties pass through). */
export function countCalls<T extends object>(target: T): { proxy: T; count: () => number; reset: () => void } {
  let n = 0;
  const proxy = new Proxy(target, {
    get(obj, prop, receiver) {
      const v = Reflect.get(obj, prop, receiver);
      if (typeof v === 'function' && typeof prop === 'string' && prop !== 'then') {
        return (...args: unknown[]) => {
          n++;
          return (v as (...a: unknown[]) => unknown).apply(obj, args);
        };
      }
      return v;
    },
  });
  return { proxy, count: () => n, reset: () => (n = 0) };
}

/** LLM mock with a settable structured output and an optional failure. */
export class ScriptedLLM extends MockLLMProvider {
  output: unknown = {};
  failWith: Error | null = null;

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    if (this.failWith) throw this.failWith;
    const data = (req.schema as z.ZodType<T>).parse(this.output);
    return {
      data,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: JSON.stringify(this.output),
      attempts: 1,
    };
  }

  structuredCalls() {
    return this.calls.filter((c) => c.method === 'completeStructured');
  }

  /** All text the model was sent in the latest structured call (every message). */
  lastInput(): string {
    const calls = this.structuredCalls();
    const req = calls[calls.length - 1]?.req as { messages: { content: unknown }[] } | undefined;
    return (req?.messages ?? []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  }
}

/** A model output whose paths are real (inside the hunk 10-13 of `path`). */
export const validOutput = (path: string, summary = 'Adds a thing.') => ({
  summary,
  risks: [
    { kind: 'security', title: 'Risky change', explanation: 'Because.', severity: 'high', file_refs: [`${path}:11-12`] },
  ],
  review_focus: [{ file: path, line: 11, reason: 'Start here.' }],
});

/** A model output where every path is invented. */
export const inventedOutput = () => ({
  summary: 'Only invented paths below.',
  risks: [
    { kind: 'other', title: 'Ghost', explanation: 'x', severity: 'low', file_refs: ['src/invented.ts:3'] },
  ],
  review_focus: [{ file: 'src/invented.ts', line: 3, reason: 'does not exist' }],
});

let prSeq = 0;

/** A fresh repo + PR (own number space, own head sha) — nothing shared between tests. */
export async function insertBriefPr(
  db: TestDb,
  workspaceId: string,
  opts: { clonePath?: string | null; body?: string } = {},
) {
  const n = prSeq++;
  const name = `brief-repo-${n}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath: opts.clonePath ?? null })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 1,
      title: `Brief PR ${n}`,
      author: 'dev',
      branch: 'feat/x',
      base: 'main',
      headSha: `sha-brief-${n}`,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: opts.body ?? 'A plain description.',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

/**
 * Run `fn` while collecting the JSON log lines pino writes to stdout/stderr
 * (sonic-boom uses `fs.writeSync`). Output is swallowed while capturing.
 */
export async function captureLogLines<T>(fn: () => Promise<T>): Promise<{ result: T; lines: Record<string, unknown>[] }> {
  const chunks: string[] = [];
  const origSync = fs.writeSync;
  const syncSpy = vi.spyOn(fs, 'writeSync').mockImplementation(((fd: number, ...args: unknown[]) => {
    if (fd === 1 || fd === 2) {
      const s = String(args[0]);
      chunks.push(s);
      return s.length;
    }
    return (origSync as (...a: unknown[]) => number)(fd, ...args);
  }) as typeof fs.writeSync);
  const origWrite = fs.write;
  const writeSpy = vi.spyOn(fs, 'write').mockImplementation(((fd: number, ...args: unknown[]) => {
    if (fd === 1 || fd === 2) {
      const s = String(args[0]);
      chunks.push(s);
      const cb = args[args.length - 1];
      if (typeof cb === 'function') (cb as (e: null, n: number) => void)(null, s.length);
      return;
    }
    return (origWrite as (...a: unknown[]) => unknown)(fd, ...args);
  }) as unknown as typeof fs.write);
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((s: unknown) => {
    chunks.push(String(s));
    return true;
  }) as typeof process.stdout.write);
  try {
    const result = await fn();
    const lines = chunks
      .join('')
      .split('\n')
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as Record<string, unknown>];
        } catch {
          return [];
        }
      });
    return { result, lines };
  } finally {
    syncSpy.mockRestore();
    writeSpy.mockRestore();
    outSpy.mockRestore();
  }
}
