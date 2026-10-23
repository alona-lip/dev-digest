import {
  Intent,
  type FeatureModelChoice,
  type GitHubClient,
  type LLMProvider,
  type PrIntentRecord,
  type UnifiedDiff,
  type UrlFetcher,
} from '@devdigest/shared';
import type { PullRow, RepoRow } from '../../db/rows.js';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { renderPrompt } from '../../platform/prompts.js';
import type { RepoIntel } from '../repo-intel/index.js';
import { loadDiff, type ReviewRepository } from '../reviews/index.js';
import { resolveFeatureModel } from '../settings/index.js';
import { LLM_TEMPERATURE, REFERENCE_BUDGET_CHARS, URL_FETCH } from './constants.js';
import {
  applyBudget,
  buildClassifierMessage,
  htmlToText,
  issueText,
  normalizeIntent,
  parseReferences,
  referenceSource,
  renderIntentBlock,
  tokenSavings,
  type ParsedReference,
  type PrSelf,
  type ResolvedReference,
} from './helpers.js';

/**
 * Where progress goes: the run's Live Log (RunLogger fits as-is) or the request
 * logger (routes adapt pino's `(obj, msg)` to this).
 */
export interface IntentLog {
  info(msg: string, data?: unknown): void;
}

/** The collaborators the service uses — narrow, so tests can fake each one. */
export interface IntentDeps {
  reviews: Pick<ReviewRepository, 'getPull' | 'getRepo' | 'getIntent' | 'upsertIntent'>;
  loadDiff(workspaceId: string, pull: PullRow, repo: RepoRow): Promise<UnifiedDiff>;
  /** Guarded clone read: null when not cloned, missing, or the path escapes the clone (`..`, symlink). */
  repoIntel: Pick<RepoIntel, 'readRepoFile'>;
  /** null when no PAT is configured — GitHub references are then skipped. */
  github(): Promise<Pick<GitHubClient, 'getIssue' | 'getPullRequest'> | null>;
  /** null when EXTERNAL_FETCH_ENABLED=false — URL references are then skipped. */
  urlFetcher: UrlFetcher | null;
  /** Settings → Feature Models → PR Review · Intent (never a hardcoded model). */
  model(workspaceId: string): Promise<FeatureModelChoice>;
  llm(provider: FeatureModelChoice['provider']): Promise<LLMProvider>;
}

/** What the container exposes and what routes / the review run call — tests fake exactly this. */
export type IntentPort = Pick<IntentService, 'getOrCompute' | 'recompute' | 'forRun'>;

/** What a review run gets: the intent, the block for the prompt, and where it came from. */
export interface RunIntent {
  intent: Intent;
  block: string;
  source: 'stored' | 'computed';
}

/**
 * Intent Layer: a cheap model derives a PR's purpose and scope from its title,
 * description, referenced docs/issues and the changed files' hunk headers —
 * never the change bodies — and stores it per PR (`pr_intent`).
 *
 *   PARSE    (code)  references in the PR body
 *   RESOLVE  (I/O)   each one best-effort: repo file, GitHub item, https page
 *   CLASSIFY (LLM)   one structured call on the `review_intent` feature model
 */
export class IntentService {
  /**
   * One derivation per PR at a time. Concurrent callers — a second tab, the
   * Overview GET racing a review run — share the in-flight model call instead
   * of each paying for their own. Cleared when it settles, so a failure is
   * retried by the next caller rather than cached.
   */
  private readonly inflight = new Map<string, Promise<Intent>>();

  constructor(private readonly deps: IntentDeps) {}

  /** Stored intent, or compute + store it now (Overview opens → lazy compute). */
  async getOrCompute(workspaceId: string, prId: string, log?: IntentLog): Promise<PrIntentRecord> {
    const { pull, repo } = await this.load(workspaceId, prId);
    const stored = await this.deps.reviews.getIntent(pull.id);
    if (stored) return { ...stored, pr_id: pull.id };
    return { ...(await this.derive(workspaceId, pull, repo, undefined, log)), pr_id: pull.id };
  }

  /** Always recompute (Overview → Recompute) and overwrite the stored intent. */
  async recompute(workspaceId: string, prId: string, log?: IntentLog): Promise<PrIntentRecord> {
    const { pull, repo } = await this.load(workspaceId, prId);
    return { ...(await this.derive(workspaceId, pull, repo, undefined, log)), pr_id: pull.id };
  }

  /** For a review run: reuse the stored intent, else compute it from the run's already-loaded diff. */
  async forRun(
    workspaceId: string,
    pull: PullRow,
    repo: RepoRow,
    diff: UnifiedDiff,
    log?: IntentLog,
  ): Promise<RunIntent> {
    const stored = await this.deps.reviews.getIntent(pull.id);
    if (stored) return { intent: stored, block: renderIntentBlock(stored), source: 'stored' };
    const intent = await this.derive(workspaceId, pull, repo, diff, log);
    return { intent, block: renderIntentBlock(intent), source: 'computed' };
  }

  /** Join the PR's in-flight derivation, or start one (loading the diff unless the caller has it). */
  private derive(
    workspaceId: string,
    pull: PullRow,
    repo: RepoRow,
    diff: UnifiedDiff | undefined,
    log?: IntentLog,
  ): Promise<Intent> {
    const running = this.inflight.get(pull.id);
    if (running) return running;
    const task = (async () =>
      this.compute(workspaceId, pull, repo, diff ?? (await this.deps.loadDiff(workspaceId, pull, repo)), log))().finally(
      () => this.inflight.delete(pull.id),
    );
    this.inflight.set(pull.id, task);
    return task;
  }

  private async load(workspaceId: string, prId: string): Promise<{ pull: PullRow; repo: RepoRow }> {
    const pull = await this.deps.reviews.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.deps.reviews.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return { pull, repo };
  }

  private async compute(
    workspaceId: string,
    pull: PullRow,
    repo: RepoRow,
    diff: UnifiedDiff,
    log?: IntentLog,
  ): Promise<Intent> {
    const self: PrSelf = { owner: repo.owner, name: repo.name, number: pull.number };
    const resolved = await this.resolveReferences(parseReferences(pull.body, self), self, repo.id, log);
    const { refs, truncated } = applyBudget(resolved, REFERENCE_BUDGET_CHARS);
    if (truncated) log?.info(`intent: reference content cut to the ${REFERENCE_BUDGET_CHARS}-char budget`);

    const message = buildClassifierMessage({ title: pull.title, body: pull.body, references: refs, diff });
    const choice = await this.deps.model(workspaceId);
    const llm = await this.deps.llm(choice.provider);
    const res = await llm.completeStructured({
      model: choice.model,
      schema: Intent,
      schemaName: 'Intent',
      messages: [
        { role: 'system', content: await renderPrompt('intent.system.md', {}) },
        { role: 'user', content: message },
      ],
      temperature: LLM_TEMPERATURE,
    });

    const s = tokenSavings(diff.raw, message);
    log?.info(
      `intent: header-only input ~${s.headerOnlyTokens} tok vs full diff ~${s.fullDiffTokens} tok → saved ~${s.savedTokens} (${s.savedPct}%, estimate)`,
      {
        ...s,
        references: refs.map((r) => r.source),
        refsChars: refs.reduce((n, r) => n + r.content.length, 0),
        model: `${choice.provider}/${choice.model}`,
        costUsd: res.costUsd,
      },
    );

    const intent = normalizeIntent(res.data, pull.title);
    await this.deps.reviews.upsertIntent(pull.id, intent);
    return intent;
  }

  /** Fetch every reference in parallel; a failure skips that one (logged), never the whole compute. */
  private async resolveReferences(
    parsed: ParsedReference[],
    self: PrSelf,
    repoId: string,
    log?: IntentLog,
  ): Promise<ResolvedReference[]> {
    if (parsed.length === 0) return [];
    const github = parsed.some((r) => r.kind === 'github') ? await this.deps.github().catch(() => null) : null;
    const settled = await Promise.allSettled(parsed.map((ref) => this.fetchReference(ref, repoId, github)));
    const out: ResolvedReference[] = [];
    settled.forEach((result, i) => {
      const ref = parsed[i]!;
      const source = referenceSource(ref, self);
      if (result.status === 'rejected') {
        log?.info(`intent: reference ${source} skipped — ${(result.reason as Error)?.message ?? 'failed'}`);
      } else if (result.value === null) {
        log?.info(`intent: reference ${source} skipped — ${skipReason(ref)}`);
      } else if (result.value.trim().length > 0) {
        out.push({ kind: ref.kind, source, content: result.value });
      }
    });
    if (out.length > 0) log?.info(`intent: ${out.length} reference(s) resolved`, { sources: out.map((r) => r.source) });
    return out;
  }

  /** Content of one reference, or null when its fetcher is unavailable / the content isn't text. */
  private async fetchReference(
    ref: ParsedReference,
    repoId: string,
    github: Pick<GitHubClient, 'getIssue' | 'getPullRequest'> | null,
  ): Promise<string | null> {
    switch (ref.kind) {
      case 'repo-file':
        return this.deps.repoIntel.readRepoFile(repoId, ref.path);
      case 'github': {
        if (!github) return null;
        const repoRef = { owner: ref.owner, name: ref.name };
        // The issues endpoint answers for PR numbers too; fall back for odd cases.
        try {
          return issueText(await github.getIssue(repoRef, ref.number));
        } catch {
          return issueText(await github.getPullRequest(repoRef, ref.number));
        }
      }
      case 'url': {
        if (!this.deps.urlFetcher) return null;
        const res = await this.deps.urlFetcher.fetch(ref.url, URL_FETCH);
        const type = res.contentType?.toLowerCase() ?? '';
        if (!type.startsWith('text/')) return null;
        const text = new TextDecoder().decode(res.bytes);
        return type.startsWith('text/html') ? htmlToText(text) : text;
      }
    }
  }
}

function skipReason(ref: ParsedReference): string {
  if (ref.kind === 'repo-file') return 'not in the clone';
  return ref.kind === 'github' ? 'no GitHub token' : 'external fetch disabled or not a text page';
}

/** Composition: wire the service to the container's repositories, adapters and settings. */
export function createIntentService(container: Container): IntentService {
  return new IntentService({
    reviews: container.reviewRepo,
    loadDiff: (workspaceId, pull, repo) => loadDiff(container, container.reviewRepo, workspaceId, pull, repo),
    repoIntel: container.repoIntel,
    github: () => container.github().catch(() => null),
    urlFetcher: container.config.externalFetchEnabled ? container.urlFetcher : null,
    model: (workspaceId) => resolveFeatureModel(container, workspaceId, 'review_intent'),
    llm: (provider) => container.llm(provider),
  });
}
