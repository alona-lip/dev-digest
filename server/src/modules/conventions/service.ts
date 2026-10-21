import {
  ConventionCategory,
  type ConventionCandidate,
  type ConventionSkillDraft,
  type CreateConventionSkillInput,
  type ExtractConventionsResult,
  type FeatureModelChoice,
  type LLMProvider,
  type Skill,
  type UpdateConventionInput,
  type BulkConventionStatusInput,
} from '@devdigest/shared';
import type { AgentRow, RepoRow } from '../../db/rows.js';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { wrapUntrusted } from '../../platform/prompt.js';
import { renderPrompt } from '../../platform/prompts.js';
import type { RepoIntel } from '../repo-intel/index.js';
import { resolveFeatureModel } from '../settings/index.js';
import { SkillsService } from '../skills/index.js';
import {
  CONFIG_FILES,
  LLM_TEMPERATURE,
  MAX_CANDIDATES,
  SAMPLE_FILES,
  SKILL_CHANGE_NOTE,
  SKILL_NAME,
} from './constants.js';
import { buildSample, buildSkillDraft, dedupeRules, groundCandidates, toConventionDto } from './helpers.js';
import { ConventionRepository } from './repository/convention.repo.js';
import { ConventionExtraction } from './schema.js';

/** The collaborators the service uses — narrow, so tests can fake each one. */
export interface ConventionsDeps {
  conventions: ConventionRepository;
  repos: { getById(workspaceId: string, id: string): Promise<RepoRow | undefined> };
  agents: {
    getById(workspaceId: string, id: string): Promise<AgentRow | undefined>;
    linkedSkills(agentId: string): Promise<{ skill: { id: string }; order: number }[]>;
    linkSkill(agentId: string, skillId: string, order: number): Promise<void>;
  };
  repoIntel: Pick<RepoIntel, 'getConventionSamples' | 'readRepoFile'>;
  skills: Pick<SkillsService, 'upsertByName' | 'findByName'>;
  /** Settings → Feature Models → Conventions (never a hardcoded model). */
  model(workspaceId: string): Promise<FeatureModelChoice>;
  llm(provider: FeatureModelChoice['provider']): Promise<LLMProvider>;
}

/**
 * Conventions Extractor: find the house rules a repo already follows, let the
 * user triage them, and merge the accepted ones into one skill.
 *
 * Only the middle step of a scan is a model call:
 *   SAMPLE (code)  config files + repo-intel's top-ranked files
 *   PROPOSE (LLM)  one structured call → candidates with file+line evidence
 *   VERIFY (code)  the evidence gate drops any candidate whose snippet isn't in the file
 */
export class ConventionsService {
  constructor(private readonly deps: ConventionsDeps) {}

  private async repoOrThrow(workspaceId: string, repoId: string): Promise<RepoRow> {
    const repo = await this.deps.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    await this.repoOrThrow(workspaceId, repoId);
    return (await this.deps.conventions.listOpen(workspaceId, repoId)).map(toConventionDto);
  }

  async extract(workspaceId: string, repoId: string): Promise<ExtractConventionsResult> {
    const repo = await this.repoOrThrow(workspaceId, repoId);
    if (!repo.clonePath) {
      throw new ValidationError('The repo is not cloned yet — wait for the clone to finish, then scan.');
    }

    // SAMPLE — pure code, no model.
    const ranked = await this.deps.repoIntel.getConventionSamples(repoId, SAMPLE_FILES);
    if (ranked.length === 0) {
      throw new ValidationError('No source files to sample — index the repo first (Re-analyze), then scan.');
    }
    const paths = [...new Set<string>([...CONFIG_FILES, ...ranked])];
    const read = await Promise.all(
      paths.map(async (path) => ({ path, content: await this.deps.repoIntel.readRepoFile(repoId, path) })),
    );
    const sample = buildSample(
      read.filter((f): f is { path: string; content: string } => f.content !== null),
    );
    if (sample.files.length === 0) {
      throw new ValidationError('None of the sampled files could be read from the clone.');
    }

    // PROPOSE — one structured call on the workspace's Conventions model.
    const choice = await this.deps.model(workspaceId);
    const llm = await this.deps.llm(choice.provider);
    const system = await renderPrompt('conventions.system.md', {
      max: String(MAX_CANDIDATES),
      categories: ConventionCategory.options.join(', '),
    });
    const user =
      `Repository: ${repo.fullName}\n\n` +
      `Sampled files (${sample.files.length}), each line prefixed with its 1-based line number:\n\n` +
      wrapUntrusted('repo-files', sample.text);
    const res = await llm.completeStructured({
      model: choice.model,
      schema: ConventionExtraction,
      schemaName: 'ConventionExtraction',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: LLM_TEMPERATURE,
    });
    const proposed = res.data.conventions.slice(0, MAX_CANDIDATES);

    // VERIFY — code checks every citation, then drops rules already on the list.
    // Read-dedupe-insert runs under a per-repo lock: an overlapping scan waits here
    // and then sees this one's rows, instead of inserting the same rules again.
    // The model call above stays outside, so no connection is held during it.
    const { kept, dropped } = groundCandidates(proposed, sample.files);
    const { duplicates } = await this.deps.conventions.inTransaction(async (repo) => {
      await repo.lockRepo(repoId);
      const existing = await repo.listByRepo(workspaceId, repoId);
      const deduped = dedupeRules(kept, existing.map((r) => r.rule));
      await repo.insertMany(deduped.fresh.map((c) => ({ workspaceId, repoId, ...c })));
      return deduped;
    });

    return {
      candidates: await this.list(workspaceId, repoId),
      stats: {
        sampled_files: sample.files.length,
        proposed: proposed.length,
        dropped_ungrounded: dropped.length,
        dropped_duplicate: duplicates,
      },
      model: res.model,
      cost_usd: res.costUsd,
    };
  }

  async update(workspaceId: string, id: string, input: UpdateConventionInput): Promise<ConventionCandidate> {
    const row = await this.deps.conventions.update(workspaceId, id, input);
    if (!row) throw new NotFoundError('Convention not found');
    return toConventionDto(row);
  }

  async setStatusMany(
    workspaceId: string,
    repoId: string,
    input: BulkConventionStatusInput,
  ): Promise<ConventionCandidate[]> {
    await this.repoOrThrow(workspaceId, repoId);
    await this.deps.conventions.setStatusMany(workspaceId, repoId, input.ids, input.status);
    return this.list(workspaceId, repoId);
  }

  private async acceptedOrThrow(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const accepted = (await this.deps.conventions.listAccepted(workspaceId, repoId)).map(toConventionDto);
    if (accepted.length === 0) throw new ValidationError('Accept at least one convention first.');
    return accepted;
  }

  /** The skill the ACCEPTED candidates merge into. Writes nothing. */
  async skillDraft(workspaceId: string, repoId: string): Promise<ConventionSkillDraft> {
    const repo = await this.repoOrThrow(workspaceId, repoId);
    const accepted = await this.acceptedOrThrow(workspaceId, repoId);
    const existing = await this.deps.skills.findByName(workspaceId, SKILL_NAME);
    return {
      ...buildSkillDraft(repo.name, accepted),
      accepted_count: accepted.length,
      existing_skill: existing ? { id: existing.id, version: existing.version } : null,
    };
  }

  /**
   * Save the (edited) draft — a new skill, or the next version of the one with
   * this name — and link it to the chosen agent. The link is additive: the
   * agent keeps its other skills, and an existing link keeps its position.
   */
  async createSkill(workspaceId: string, repoId: string, input: CreateConventionSkillInput): Promise<Skill> {
    await this.repoOrThrow(workspaceId, repoId);
    await this.acceptedOrThrow(workspaceId, repoId);
    const agent = await this.deps.agents.getById(workspaceId, input.agent_id);
    if (!agent) throw new NotFoundError('Agent not found');

    const { agent_id: _agentId, ...fields } = input;
    const skill = await this.deps.skills.upsertByName(
      workspaceId,
      { ...fields, source: 'extracted' },
      SKILL_CHANGE_NOTE,
    );

    const links = await this.deps.agents.linkedSkills(agent.id);
    const current = links.find((l) => l.skill.id === skill.id);
    const nextOrder = links.reduce((max, l) => Math.max(max, l.order + 1), 0);
    await this.deps.agents.linkSkill(agent.id, skill.id, current?.order ?? nextOrder);
    return skill;
  }
}

/** Wire the service from the container (composition happens here, not in the route). */
export function createConventionsService(container: Container): ConventionsService {
  return new ConventionsService({
    conventions: new ConventionRepository(container.db),
    repos: container.reposRepo,
    agents: container.agentsRepo,
    repoIntel: container.repoIntel,
    skills: new SkillsService(container),
    model: (workspaceId) => resolveFeatureModel(container, workspaceId, 'conventions'),
    llm: (provider) => container.llm(provider),
  });
}
