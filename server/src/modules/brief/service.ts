import {
  BriefModelOutput,
  BriefRecord,
  type BriefMissingInput,
  type BriefResponse,
  type FeatureModelChoice,
  type GitHubClient,
  type Intent,
  type LLMProvider,
  type PrBlastRadius,
  type PrFile,
  type UnifiedDiff,
} from '@devdigest/shared';
import type { PullRow, RepoRow } from '../../db/rows.js';
import type { Container } from '../../platform/container.js';
import { AppError, ExternalServiceError, NotFoundError } from '../../platform/errors.js';
import { renderPrompt } from '../../platform/prompts.js';
import { issueText, parseReferences, type PrSelf } from '../intent/index.js';
import type { ProjectContextPort } from '../project-context/index.js';
import { loadDiff, type ReviewRepository } from '../reviews/index.js';
import { resolveFeatureModel } from '../settings/index.js';
import { BRIEF_SCHEMA_NAME, BRIEF_TOKEN_BUDGET, LLM_TEMPERATURE } from './constants.js';
import {
  fileStatsFromDiff,
  fileStatsFromPrFiles,
  fitBudget,
  postValidate,
  toBriefResponse,
  withPatchlessFiles,
  type BriefSections,
  type FileStat,
} from './helpers.js';
import * as briefs from './repository/brief.repo.js';

/** Where progress goes: the request logger (routes adapt pino's `(obj, msg)` to this). */
export interface BriefLog {
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
}

type BriefDocs = Awaited<ReturnType<ProjectContextPort['forBrief']>>;

/** The collaborators the service uses — plain functions / objects, so tests fake each one. */
export interface BriefDeps {
  reviews: Pick<ReviewRepository, 'getPull' | 'getRepo' | 'getIntent' | 'getPrFiles'>;
  /** The persisted brief JSON of a PR (`pr_brief`), parsed by the service. */
  briefs: {
    get(prId: string): Promise<unknown | undefined>;
    upsert(prId: string, json: unknown): Promise<void>;
  };
  /** Local diff (git, else persisted patches). May be empty or throw. */
  loadDiff(workspaceId: string, pull: PullRow, repo: RepoRow): Promise<UnifiedDiff>;
  /** The PR's file list from GitHub (with patches). Throws when unreachable / no token. */
  githubFiles(pull: PullRow, repo: RepoRow): Promise<PrFile[]>;
  /** null when no PAT is configured — linked issues are then skipped. */
  github(): Promise<Pick<GitHubClient, 'getIssue' | 'getPullRequest'> | null>;
  /** Blast radius of the PR; may be degraded, may throw. */
  blast(workspaceId: string, prId: string): Promise<PrBlastRadius>;
  /** Attached project documents (union over enabled agents), unbudgeted. */
  docs(workspaceId: string, repoId: string): Promise<BriefDocs>;
  /** Settings → Feature Models → PR Brief (never a hardcoded model). */
  model(workspaceId: string): Promise<FeatureModelChoice>;
  llm(provider: FeatureModelChoice['provider']): Promise<LLMProvider>;
  /** The brief's system prompt. */
  system(): Promise<string>;
  /** tiktoken token count of a text. */
  count(text: string): number;
  now(): Date;
}

/** What the container exposes and what routes call — tests fake exactly this. */
export type BriefPort = Pick<BriefService, 'read' | 'generate'>;

type Gathered = {
  intent: Intent | null;
  blast: PrBlastRadius | null;
  /** The real map even when degraded: `postValidate` ignores a degraded one itself. */
  rawBlast: PrBlastRadius | null;
  issues: { source: string; text: string }[];
  documents: { path: string; text: string }[];
  missing: BriefMissingInput[];
};

/**
 * PR brief: one structured model call over the PR's title, description, intent,
 * blast radius, changed-file line ranges (never code), linked issues and
 * attached project documents. The output is grounded against the real diff and
 * stored per PR in `pr_brief` (head sha inside the JSON, so no migration).
 *
 * Every input except the changed files is best-effort: its absence is named in
 * `missing_inputs`, never an error.
 */
export class BriefService {
  /**
   * One generation per PR at a time. A second tab or a double click shares the
   * in-flight model call instead of paying for another. Cleared in `finally`,
   * so a failure is retried by the next caller rather than cached.
   */
  private readonly inflight = new Map<string, Promise<BriefResponse>>();

  constructor(private readonly deps: BriefDeps) {}

  /** The stored brief with its staleness, or `{status:'none'}`. Never touches the model or GitHub. */
  async read(workspaceId: string, prId: string, log?: BriefLog): Promise<BriefResponse> {
    const { pull } = await this.load(workspaceId, prId);
    const json = await this.deps.briefs.get(pull.id);
    if (json === undefined) return { status: 'none' };
    const parsed = BriefRecord.safeParse(json);
    if (!parsed.success) {
      log?.warn('brief: stored brief does not match the schema; treated as none', {
        prId: pull.id,
        issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return { status: 'none' };
    }
    return toBriefResponse(parsed.data, pull.headSha);
  }

  /** Generate (or join the PR's in-flight generation), store, and return the fresh brief. */
  async generate(workspaceId: string, prId: string, log?: BriefLog): Promise<BriefResponse> {
    const { pull, repo } = await this.load(workspaceId, prId);
    const running = this.inflight.get(pull.id);
    if (running) return running;
    const task = this.run(workspaceId, pull, repo, log).finally(() => this.inflight.delete(pull.id));
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

  private async run(workspaceId: string, pull: PullRow, repo: RepoRow, log?: BriefLog): Promise<BriefResponse> {
    const startedAt = this.deps.now().getTime();
    // Captured once: the brief is stored against the head it was generated for (AC-23).
    const headSha = pull.headSha;

    const files = await this.changedFiles(workspaceId, pull, repo, log);
    const g = await this.gather(workspaceId, pull, repo, log);

    const sections: BriefSections = {
      system: await this.deps.system(),
      title: pull.title,
      description: pull.body,
      intent: g.intent,
      blast: g.blast,
      files,
      issues: g.issues,
      documents: g.documents,
    };
    const fit = fitBudget(sections, (text) => this.deps.count(text), BRIEF_TOKEN_BUDGET);
    if ('tooLarge' in fit) {
      log?.warn('brief: input too large', {
        prId: pull.id,
        untrimmableTokens: fit.untrimmableTokens,
        budget: BRIEF_TOKEN_BUDGET,
      });
      throw new AppError(
        'brief_input_too_large',
        `This PR is too large to brief: its title, intent, blast radius and file list alone take ~${fit.untrimmableTokens} tokens (limit ${BRIEF_TOKEN_BUDGET}).`,
        422,
      );
    }
    for (const t of fit.trimmed) {
      log?.info(`brief: trimmed ${t.input} (~${t.tokens} tok removed)`, { input: t.input, tokens: t.tokens });
    }

    const choice = await this.deps.model(workspaceId);
    const model = `${choice.provider}/${choice.model}`;
    // Resolved outside the 502 mapping: a missing key is a ConfigError (500), not a
    // provider failure, and nothing has been called or stored yet.
    const llm = await this.deps.llm(choice.provider);
    let res: Awaited<ReturnType<LLMProvider['completeStructured']>> & { data: BriefModelOutput };
    try {
      res = await llm.completeStructured({
        model: choice.model,
        schema: BriefModelOutput,
        schemaName: BRIEF_SCHEMA_NAME,
        messages: fit.messages,
        temperature: LLM_TEMPERATURE,
      });
    } catch (err) {
      // The global error handler does not log AppErrors — log here, before the 502.
      const message = err instanceof Error ? err.message : String(err);
      log?.warn('brief: model call failed', { prId: pull.id, model, err: message });
      log?.info('brief: generated', {
        prId: pull.id,
        model,
        failed: true,
        inputTokens: fit.inputTokens,
        outputTokens: 0,
        costUsd: null,
        missingInputs: g.missing,
        trimmedInputs: fit.trimmed.map((t) => t.input),
        droppedRisks: 0,
        droppedFocus: 0,
        durationMs: this.deps.now().getTime() - startedAt,
      });
      throw new ExternalServiceError(
        'Could not generate the brief: the model call failed or returned invalid output. Nothing was saved; try again.',
      );
    }

    const checked = postValidate(res.data, files, g.rawBlast);
    const record: BriefRecord = {
      pr_id: pull.id,
      head_sha: headSha,
      generated_at: this.deps.now().toISOString(),
      model,
      summary: res.data.summary,
      risks: checked.risks,
      review_focus: checked.review_focus,
      missing_inputs: g.missing,
      trimmed_inputs: fit.trimmed.map((t) => t.input),
      dropped: checked.dropped,
      input_tokens: res.tokensIn,
      cost_usd: res.costUsd,
    };
    await this.deps.briefs.upsert(pull.id, record);

    log?.info('brief: generated', {
      prId: pull.id,
      model,
      inputTokens: res.tokensIn,
      outputTokens: res.tokensOut,
      costUsd: res.costUsd,
      missingInputs: g.missing,
      trimmedInputs: record.trimmed_inputs,
      droppedRisks: checked.dropped.risks,
      droppedFocus: checked.dropped.review_focus,
      durationMs: this.deps.now().getTime() - startedAt,
    });
    return { status: 'ready', stale: false, current_head_sha: headSha, brief: record };
  }

  /** Local diff first; if it is empty or throws, GitHub's file list. Neither → 502; none changed → 422. */
  private async changedFiles(
    workspaceId: string,
    pull: PullRow,
    repo: RepoRow,
    log?: BriefLog,
  ): Promise<FileStat[]> {
    let files: FileStat[] = [];
    try {
      files = fileStatsFromDiff(await this.deps.loadDiff(workspaceId, pull, repo));
      if (files.length > 0) {
        // The diff skips files without a patch (binary, rename); keep them as bare paths.
        try {
          files = withPatchlessFiles(files, await this.deps.reviews.getPrFiles(pull.id));
        } catch (err) {
          log?.warn('brief: stored file list unavailable', { prId: pull.id, err: errMessage(err) });
        }
      }
    } catch (err) {
      log?.warn('brief: local diff unavailable', { prId: pull.id, err: errMessage(err) });
    }
    if (files.length === 0) {
      try {
        files = fileStatsFromPrFiles(await this.deps.githubFiles(pull, repo));
      } catch (err) {
        log?.warn('brief: changed files unavailable (no local diff, GitHub lookup failed)', {
          prId: pull.id,
          err: errMessage(err),
        });
        throw new ExternalServiceError(
          "Could not determine this PR's changed files: there is no local diff and GitHub did not answer. " +
            'Check the GitHub token in Settings, then retry.',
        );
      }
    }
    if (files.length === 0) {
      throw new AppError('no_changed_files', 'This PR has no changed files to brief.', 422);
    }
    return files;
  }

  /** The best-effort inputs, in parallel. A failure of any one only adds a `missing_inputs` entry. */
  private async gather(workspaceId: string, pull: PullRow, repo: RepoRow, log?: BriefLog): Promise<Gathered> {
    const self: PrSelf = { owner: repo.owner, name: repo.name, number: pull.number };
    const [intentR, blastR, issuesR, docsR] = await Promise.allSettled([
      this.deps.reviews.getIntent(pull.id),
      this.deps.blast(workspaceId, pull.id),
      this.linkedIssues(pull, self),
      this.deps.docs(workspaceId, repo.id),
    ]);
    const missing: BriefMissingInput[] = [];

    let intent: Intent | null = null;
    if (intentR.status === 'fulfilled' && intentR.value) intent = intentR.value;
    else {
      if (intentR.status === 'rejected') log?.warn('brief: intent read failed', { err: errMessage(intentR.reason) });
      missing.push({ input: 'intent', reason: intentR.status === 'rejected' ? 'error' : 'not_computed' });
    }

    let blast: PrBlastRadius | null = null;
    let rawBlast: PrBlastRadius | null = null;
    if (blastR.status === 'fulfilled') {
      rawBlast = blastR.value;
      if (blastR.value.degraded) missing.push({ input: 'blast', reason: blastR.value.reason ?? 'no_data' });
      else blast = blastR.value;
    } else {
      log?.warn('brief: blast radius failed', { err: errMessage(blastR.reason) });
      missing.push({ input: 'blast', reason: 'error' });
    }

    let issues: Gathered['issues'] = [];
    if (issuesR.status === 'fulfilled') {
      issues = issuesR.value.issues;
      if (issuesR.value.missing) missing.push({ input: 'linked_issue', reason: issuesR.value.missing });
    } else {
      log?.warn('brief: linked issues failed', { err: errMessage(issuesR.reason) });
      missing.push({ input: 'linked_issue', reason: 'fetch_failed' });
    }

    let documents: Gathered['documents'] = [];
    if (docsR.status === 'fulfilled') {
      documents = docsR.value.docs.map((d) => ({ path: d.path, text: d.text }));
      if (docsR.value.attached > 0 && documents.length === 0) {
        missing.push({ input: 'specs', reason: docsR.value.notCloned ? 'not_cloned' : 'unreadable' });
      }
    } else {
      log?.warn('brief: project documents failed', { err: errMessage(docsR.reason) });
      missing.push({ input: 'specs', reason: 'unreadable' });
    }

    return { intent, blast, rawBlast, issues, documents, missing };
  }

  /** GitHub issue / PR references of the body (the Intent Layer's parser), fetched best-effort. */
  private async linkedIssues(
    pull: PullRow,
    self: PrSelf,
  ): Promise<{ issues: { source: string; text: string }[]; missing: string | null }> {
    const refs = parseReferences(pull.body, self).filter((r) => r.kind === 'github');
    if (refs.length === 0) return { issues: [], missing: null };
    const github = await this.deps.github();
    if (!github) return { issues: [], missing: 'no_github_token' };

    const settled = await Promise.allSettled(
      refs.map(async (ref) => {
        const repoRef = { owner: ref.owner, name: ref.name };
        // The issues endpoint answers for PR numbers too; fall back for odd cases.
        let text: string;
        try {
          text = issueText(await github.getIssue(repoRef, ref.number));
        } catch {
          text = issueText(await github.getPullRequest(repoRef, ref.number));
        }
        return { source: refLabel(ref, self), text };
      }),
    );
    const issues = settled.flatMap((r) => (r.status === 'fulfilled' && r.value.text.trim() ? [r.value] : []));
    const failed = settled.some((r) => r.status === 'rejected');
    return { issues, missing: failed ? 'fetch_failed' : null };
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `#12` for this repo, `owner/repo#12` otherwise (same shape as the Intent Layer's source label). */
function refLabel(ref: { owner: string; name: string; number: number }, self: PrSelf): string {
  const same = ref.owner.toLowerCase() === self.owner.toLowerCase() && ref.name.toLowerCase() === self.name.toLowerCase();
  return same ? `#${ref.number}` : `${ref.owner}/${ref.name}#${ref.number}`;
}

/** Composition: wire the service to the container's repositories, adapters and settings. */
export function createBriefService(container: Container): BriefService {
  return new BriefService({
    reviews: container.reviewRepo,
    briefs: {
      get: (prId) => briefs.getBriefJson(container.db, prId),
      upsert: (prId, json) => briefs.upsertBrief(container.db, prId, json),
    },
    loadDiff: (workspaceId, pull, repo) => loadDiff(container, container.reviewRepo, workspaceId, pull, repo),
    githubFiles: async (pull, repo) => {
      const gh = await container.github();
      return (await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pull.number)).files;
    },
    github: () => container.github().catch(() => null),
    blast: (workspaceId, prId) => container.blast.forPull(workspaceId, prId),
    docs: (workspaceId, repoId) => container.projectContext.forBrief(workspaceId, repoId),
    model: (workspaceId) => resolveFeatureModel(container, workspaceId, 'risk_brief'),
    llm: (provider) => container.llm(provider),
    system: () => renderPrompt('brief.system.md', {}),
    count: (text) => container.tokenizer.count(text),
    now: () => new Date(),
  });
}
