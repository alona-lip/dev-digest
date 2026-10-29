import type {
  ContextAttachments,
  ContextDocContent,
  ContextDocList,
  ContextUsage,
  DocStat,
  DocsScope,
  ProjectDocsReader,
  SpecBlock,
  Tokenizer,
} from '@devdigest/shared';
import type { PromptSpec } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { CONTEXT_LIST_LIMIT, CONTEXT_MAX_FILE_BYTES, PROJECT_CONTEXT_TOKEN_BUDGET } from './constants.js';
import { applyBudget, buildEffectiveSet, countUsage, docTypeOf, toAttachmentDocs, toListPage, unionBriefDocs } from './helpers.js';
import * as attachments from './repository/attachment.repo.js';
import type { AttachmentKind } from './repository/attachment.repo.js';

type AttachmentDb = Parameters<typeof attachments.listPaths>[0];

/** Local structural types: the collaborators the service needs, nothing more. */
export interface ProjectContextDeps {
  getRepo(workspaceId: string, repoId: string): Promise<{ id: string; clonePath: string | null } | undefined>;
  docs: ProjectDocsReader;
  tokenizer: Tokenizer;
  /** Skills currently enabled for an agent (used by the read endpoints; runs pass their own list). */
  activeSkills(agentId: string): Promise<{ id: string; name: string }[]>;
  /** The executor the attachment repository takes (typed via the repo, not `db/client`). */
  /** Enabled agents of a workspace (any order; the pure union helper sorts). */
  enabledAgents(workspaceId: string): Promise<{ id: string; createdAt: Date | string }[]>;
  db: AttachmentDb;
  scope: DocsScope;
}

/** Minimal log sink (satisfied by `RunLogger`). */
export interface ProjectContextLog {
  info(msg: string, data?: unknown): void;
}

export interface ForRunInput {
  workspaceId: string;
  repo: { id: string; clonePath: string | null };
  agentId: string;
  /** The executor's scan-filtered active skills. */
  skills: { id: string; name: string }[];
  runLog: ProjectContextLog;
}

export interface RunContext {
  promptSpecs: PromptSpec[];
  specBlocks: SpecBlock[];
  /** Paths of the documents actually added to the prompt. */
  specsRead: string[];
  tokens: number;
}

export interface BriefDocs {
  docs: { path: string; text: string; tokens: number }[];
  /** Number of distinct attached paths found across enabled agents (readable or not). */
  attached: number;
  notCloned: boolean;
  unreadable: { path: string; reason: string }[];
}

/** What the container exposes and what routes / the executor call. */
export type ProjectContextPort = Pick<
  ProjectContextService,
  'listDocs' | 'readDoc' | 'usage' | 'getAttachments' | 'replaceAttachments' | 'forRun' | 'forBrief'
>;

const OVER_1MB = '> 1 MB';

export class ProjectContextService {
  /** `${repoId}:${path}` → tokens for the file version identified by (size, mtime). */
  private readonly tokenCache = new Map<string, { size: number; mtimeMs: number; tokens: number | null }>();

  constructor(private readonly deps: ProjectContextDeps) {}

  private async loadRepo(workspaceId: string, repoId: string) {
    const repo = await this.deps.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');
    return repo;
  }

  private async scan(clonePath: string | null): Promise<DocStat[]> {
    if (!clonePath) return [];
    return this.deps.docs.scan(clonePath, this.deps.scope);
  }

  private readScope() {
    return { ...this.deps.scope, maxBytes: CONTEXT_MAX_FILE_BYTES };
  }

  /** Tokens for one listed file, cached on (size, mtime). Null for too-large / non-text / unreadable. */
  private async tokensFor(repoId: string, clonePath: string, stat: DocStat): Promise<number | null> {
    if (stat.size_bytes > CONTEXT_MAX_FILE_BYTES) return null;
    const key = `${repoId}:${stat.path}`;
    const hit = this.tokenCache.get(key);
    if (hit && hit.size === stat.size_bytes && hit.mtimeMs === stat.mtime_ms) return hit.tokens;
    const r = await this.deps.docs.read(clonePath, stat.path, this.readScope());
    const tokens = r.kind === 'ok' ? (r.text === '' ? 0 : this.deps.tokenizer.count(r.text)) : null;
    this.tokenCache.set(key, { size: stat.size_bytes, mtimeMs: stat.mtime_ms, tokens });
    return tokens;
  }

  async listDocs(workspaceId: string, repoId: string): Promise<ContextDocList> {
    const repo = await this.loadRepo(workspaceId, repoId);
    const base = { glob: this.deps.scope.glob, read_at: new Date().toISOString() };
    if (!repo.clonePath) return { status: 'not_cloned', ...base, docs: [], truncated: false };
    const clonePath = repo.clonePath;
    const { items, truncated } = toListPage(await this.scan(clonePath), CONTEXT_LIST_LIMIT);
    const docs = await Promise.all(
      items.map(async (s) => ({
        path: s.path,
        type: docTypeOf(s.path),
        size_bytes: s.size_bytes,
        tokens: await this.tokensFor(repo.id, clonePath, s),
        too_large: s.size_bytes > CONTEXT_MAX_FILE_BYTES,
      })),
    );
    return { status: 'ok', ...base, truncated, docs };
  }

  async readDoc(workspaceId: string, repoId: string, path: string): Promise<ContextDocContent> {
    const repo = await this.loadRepo(workspaceId, repoId);
    if (!repo.clonePath) throw new NotFoundError('Repository is not cloned');
    const r = await this.deps.docs.read(repo.clonePath, path, this.readScope());
    if (r.kind === 'not_found') throw new NotFoundError('Document not found');
    if (r.kind === 'too_large') throw new AppError('too_large', `Document is too large (${OVER_1MB})`, 413);
    if (r.kind === 'not_text') throw new AppError('not_text', 'Document is not valid UTF-8 text', 415);
    return {
      path,
      type: docTypeOf(path),
      content: r.text,
      tokens: r.text === '' ? 0 : this.deps.tokenizer.count(r.text),
    };
  }

  async usage(workspaceId: string, repoId: string): Promise<ContextUsage> {
    await this.loadRepo(workspaceId, repoId);
    const [all, agentIds] = await Promise.all([
      attachments.listForRepo(this.deps.db, repoId),
      attachments.agentIdsInWorkspace(this.deps.db, workspaceId),
    ]);
    const group = <K extends string>(rows: ({ path: string } & Record<K, string>)[], key: K) => {
      const m = new Map<string, string[]>();
      for (const r of rows) m.set(r[key], [...(m.get(r[key]) ?? []), r.path]);
      return m;
    };
    const byAgent = group(all.agent, 'agent_id');
    const bySkill = group(all.skill, 'skill_id');
    // Only agents that can inherit something matter: those with skill attachments in this repo.
    const activeByAgent = new Map<string, string[]>();
    if (bySkill.size > 0) {
      await Promise.all(
        agentIds.map(async (id) => {
          const ids = (await this.deps.activeSkills(id)).map((s) => s.id).filter((s) => bySkill.has(s));
          if (ids.length > 0) activeByAgent.set(id, ids);
        }),
      );
    }
    const agentRows = new Set([...byAgent.keys(), ...activeByAgent.keys()]);
    const by_path = countUsage(
      [...agentRows].map((agent_id) => ({ agent_id, paths: byAgent.get(agent_id) ?? [] })),
      [...bySkill].map(([skill_id, paths]) => ({ skill_id, paths })),
      activeByAgent,
    );
    return { repo_id: repoId, by_path };
  }

  private async requireOwner(kind: AttachmentKind, workspaceId: string, ownerId: string) {
    if (!(await attachments.ownerInWorkspace(this.deps.db, kind, workspaceId, ownerId))) {
      throw new NotFoundError(kind === 'agent' ? 'Agent not found' : 'Skill not found');
    }
  }

  async getAttachments(
    kind: AttachmentKind,
    workspaceId: string,
    ownerId: string,
    repoId: string,
  ): Promise<ContextAttachments> {
    await this.requireOwner(kind, workspaceId, ownerId);
    const repo = await this.loadRepo(workspaceId, repoId);
    const paths = await attachments.listPaths(this.deps.db, kind, ownerId, repoId);

    // Inherited (agents only): active skills' attachments for this repo, minus the agent's own paths.
    const inheritedRefs: { path: string; skill_id: string; name: string }[] = [];
    if (kind === 'agent') {
      const skills = await this.deps.activeSkills(ownerId);
      const run = await attachments.listForRun(
        this.deps.db,
        ownerId,
        skills.map((s) => s.id),
        repoId,
      );
      const seen = new Set(paths);
      for (const s of skills) {
        for (const path of run.skillPaths.get(s.id) ?? []) {
          if (seen.has(path)) continue;
          seen.add(path);
          inheritedRefs.push({ path, skill_id: s.id, name: s.name });
        }
      }
    }

    const full = new Map((await this.scan(repo.clonePath)).map((s) => [s.path, s]));
    const meta = new Map([...full].map(([p, s]) => [p, { type: docTypeOf(p), size_bytes: s.size_bytes }]));
    const tokens = new Map<string, number | null>();
    for (const p of new Set([...paths, ...inheritedRefs.map((r) => r.path)])) {
      const stat = full.get(p);
      if (stat && repo.clonePath) tokens.set(p, await this.tokensFor(repo.id, repo.clonePath, stat));
    }
    const inheritedDocs = toAttachmentDocs(
      inheritedRefs.map((r) => r.path),
      meta,
      tokens,
    );
    return {
      repo_id: repoId,
      paths,
      docs: toAttachmentDocs(paths, meta, tokens),
      inherited: inheritedDocs.map((d, i) => {
        const ref = inheritedRefs[i]!;
        return { ...d, via_skill: { skill_id: ref.skill_id, name: ref.name } };
      }),
    };
  }

  async replaceAttachments(
    kind: AttachmentKind,
    workspaceId: string,
    ownerId: string,
    input: { repo_id: string; paths: string[] },
  ): Promise<ContextAttachments> {
    await this.requireOwner(kind, workspaceId, ownerId);
    const repo = await this.loadRepo(workspaceId, input.repo_id);

    const dupes = input.paths.filter((p, i) => input.paths.indexOf(p) !== i);
    if (dupes.length > 0) throw new ValidationError('Duplicate paths', { duplicates: [...new Set(dupes)] });

    // Validate against the FULL match set (not the capped list); `read` alone ignores `roots`.
    const full = new Map((await this.scan(repo.clonePath)).map((s) => [s.path, s]));
    const rejected: string[] = [];
    for (const path of input.paths) {
      const stat = full.get(path);
      if (!stat || !repo.clonePath || stat.size_bytes > CONTEXT_MAX_FILE_BYTES) {
        rejected.push(path);
        continue;
      }
      const r = await this.deps.docs.read(repo.clonePath, path, this.readScope());
      if (r.kind === 'not_found' || r.kind === 'too_large') rejected.push(path);
    }
    if (rejected.length > 0) throw new ValidationError('Some paths are not attachable', { rejected });

    await attachments.replacePaths(this.deps.db, kind, workspaceId, ownerId, input.repo_id, input.paths);
    return this.getAttachments(kind, workspaceId, ownerId, input.repo_id);
  }

  /**
   * Assemble the project context for one run: DB snapshot → effective set → fresh read per
   * item → token budget → Live Log. An empty set returns empty arrays and logs nothing.
   */
  async forRun(input: ForRunInput): Promise<RunContext> {
    const { repo, agentId, skills, runLog } = input;
    const snap = await attachments.listForRun(
      this.deps.db,
      agentId,
      skills.map((s) => s.id),
      repo.id,
    );
    const effective = buildEffectiveSet(
      snap.agentPaths,
      skills.map((s) => ({ skill_id: s.id, name: s.name, paths: snap.skillPaths.get(s.id) ?? [] })),
    );
    if (effective.length === 0) return { promptSpecs: [], specBlocks: [], specsRead: [], tokens: 0 };

    type Read =
      | { kind: 'ok'; text: string; tokens: number }
      | { kind: 'missing'; reason: string }
      | { kind: 'too_large' };
    const reads: Read[] = [];
    for (const item of effective) {
      if (!repo.clonePath) {
        reads.push({ kind: 'missing', reason: 'repository not cloned' });
        continue;
      }
      const r = await this.deps.docs.read(repo.clonePath, item.path, this.readScope());
      if (r.kind === 'ok') {
        reads.push({ kind: 'ok', text: r.text, tokens: r.text === '' ? 0 : this.deps.tokenizer.count(r.text) });
      } else if (r.kind === 'too_large') reads.push({ kind: 'too_large' });
      else reads.push({ kind: 'missing', reason: r.kind === 'not_text' ? 'not valid UTF-8' : 'file not found' });
    }

    const budgeted = applyBudget(
      effective.flatMap((item, i) => {
        const r = reads[i]!;
        if (r.kind === 'missing') return [];
        return [{ path: item.path, tokens: r.kind === 'ok' ? r.tokens : null, over1mb: r.kind === 'too_large' }];
      }),
      PROJECT_CONTEXT_TOKEN_BUDGET,
    );
    const statusByPath = new Map(budgeted.map((b) => [b.path, b.status]));

    const specBlocks: SpecBlock[] = [];
    const promptSpecs: PromptSpec[] = [];
    const skipLines: string[] = [];
    const attachedLines: string[] = [];
    let tokens = 0;
    effective.forEach((item, i) => {
      const r = reads[i]!;
      const base = { path: item.path, type: docTypeOf(item.path), origin: item.origin };
      if (r.kind === 'missing') {
        specBlocks.push({ ...base, status: 'missing', tokens: null, text: null });
        skipLines.push(`Spec "${item.path}" skipped: missing (${r.reason})`);
      } else if (r.kind === 'too_large') {
        specBlocks.push({ ...base, status: 'over_budget', tokens: null, text: null });
        skipLines.push(`Spec "${item.path}" skipped: over_budget (${OVER_1MB})`);
      } else if (statusByPath.get(item.path) === 'attached') {
        tokens += r.tokens;
        specBlocks.push({ ...base, status: 'attached', tokens: r.tokens, text: r.text });
        promptSpecs.push({ path: item.path, text: r.text });
        attachedLines.push(`Spec "${item.path}" (+${r.tokens} tokens)`);
      } else {
        specBlocks.push({ ...base, status: 'over_budget', tokens: r.tokens, text: null });
        skipLines.push(
          `Spec "${item.path}" skipped: over_budget (would exceed ${PROJECT_CONTEXT_TOKEN_BUDGET})`,
        );
      }
    });

    runLog.info(`Project context: ${promptSpecs.length} docs attached (+${tokens} tokens)`, {
      docs_attached: promptSpecs.length,
      docs_skipped: skipLines.length,
      context_tokens: tokens,
    });
    for (const line of attachedLines) runLog.info(line);
    for (const line of skipLines) runLog.info(line);

    return { promptSpecs, specBlocks, specsRead: promptSpecs.map((p) => p.path), tokens };
  }

  /**
   * Documents for the PR brief: union over the workspace's enabled agents (+ their active skills).
   * Applies no token budget (the brief budgets itself); unreadable items are skipped and logged.
   */
  async forBrief(workspaceId: string, repoId: string, log?: ProjectContextLog): Promise<BriefDocs> {
    const repo = await this.loadRepo(workspaceId, repoId);
    const agents = await this.deps.enabledAgents(workspaceId);
    const perAgent = await Promise.all(
      agents.map(async (a) => {
        const skills = await this.deps.activeSkills(a.id);
        const snap = await attachments.listForRun(
          this.deps.db,
          a.id,
          skills.map((s) => s.id),
          repoId,
        );
        return {
          id: a.id,
          createdAt: a.createdAt,
          agentPaths: snap.agentPaths,
          skills: skills.map((s) => ({ id: s.id, name: s.name, paths: snap.skillPaths.get(s.id) ?? [] })),
        };
      }),
    );
    const paths = unionBriefDocs(perAgent);
    const result: BriefDocs = { docs: [], attached: paths.length, notCloned: false, unreadable: [] };
    if (paths.length === 0) return result;
    const clonePath = repo.clonePath;
    if (!clonePath) {
      result.notCloned = true;
      log?.info(`Brief documents skipped: repository not cloned (${paths.length} attached)`);
      return result;
    }
    for (const path of paths) {
      let r: Awaited<ReturnType<typeof this.deps.docs.read>>;
      try {
        r = await this.deps.docs.read(clonePath, path, this.readScope());
      } catch (err) {
        // One unreadable document (EACCES, EIO, ...) must not discard the others (AC-16).
        // Log the path and error code only, never file content.
        const code = (err as NodeJS.ErrnoException | undefined)?.code ?? 'unknown error';
        result.unreadable.push({ path, reason: 'unreadable' });
        log?.info(`Brief document "${path}" skipped: unreadable (${code})`);
        continue;
      }
      if (r.kind === 'ok') {
        result.docs.push({ path, text: r.text, tokens: r.text === '' ? 0 : this.deps.tokenizer.count(r.text) });
        continue;
      }
      const reason = r.kind === 'too_large' ? OVER_1MB : r.kind === 'not_text' ? 'not valid UTF-8' : 'file not found';
      result.unreadable.push({ path, reason });
      log?.info(`Brief document "${path}" skipped: ${reason}`);
    }
    return result;
  }
}

export function createProjectContextService(container: Container): ProjectContextService {
  return new ProjectContextService({
    getRepo: (workspaceId, repoId) => container.reposRepo.getById(workspaceId, repoId),
    docs: container.projectDocs,
    tokenizer: container.tokenizer,
    activeSkills: async (agentId) =>
      (await container.agentsRepo.activeSkillsForRun(agentId)).map(({ id, name }) => ({ id, name })),
    enabledAgents: (workspaceId) => container.agentsRepo.listEnabled(workspaceId),
    db: container.db,
    scope: { glob: container.config.contextGlob, roots: container.config.contextRoots },
  });
}
