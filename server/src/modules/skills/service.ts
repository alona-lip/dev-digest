import type { Container } from '../../platform/container.js';
import type {
  CreateSkillInput,
  Skill,
  SkillImportPreview,
  SkillImportRequest,
  SkillListItem,
  SkillStats,
  SkillVersion,
  UpdateSkillInput,
} from '@devdigest/shared';
import { ConflictError, NotFoundError } from '../../platform/errors.js';
import { DEFAULT_UPDATE_NOTE, INITIAL_VERSION_NOTE } from './constants.js';
import { buildImportPreview, rate, toSkillDto, toSkillVersionDto } from './helpers.js';
import { SkillRepository, type SkillRow } from './repository/skill.repo.js';
import { SkillStatsRepository } from './repository/skill-stats.repo.js';

/** Postgres unique_violation, possibly wrapped by the driver/ORM. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | undefined;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

const nameTaken = (name: string) => new ConflictError(`A skill named "${name}" already exists`);

/**
 * Skills service. A skill is reusable, text-only agent configuration — this
 * module never executes or fetches anything. The DB is the source of truth.
 */
export class SkillsService {
  private repo: SkillRepository;
  private stats: SkillStatsRepository;

  constructor(private container: Container) {
    this.repo = new SkillRepository(container.db);
    this.stats = new SkillStatsRepository(container.db);
  }

  private dto(row: SkillRow): Skill {
    return toSkillDto(row, this.container.tokenizer.count(row.body));
  }

  async list(workspaceId: string): Promise<SkillListItem[]> {
    const [rows, rollups] = await Promise.all([
      this.repo.list(workspaceId),
      this.stats.rollups(workspaceId),
    ]);
    return rows.map((row) => {
      const r = rollups.get(row.id);
      return {
        ...this.dto(row),
        agent_count: r?.agentCount ?? 0,
        pull_rate: r ? rate(r.runsWithSkill, r.runs) : null,
        accept_rate: r ? rate(r.accepted, r.accepted + r.dismissed) : null,
      };
    });
  }

  async get(workspaceId: string, id: string): Promise<Skill> {
    const row = await this.repo.getById(workspaceId, id);
    if (!row) throw new NotFoundError('Skill not found');
    return this.dto(row);
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    if (await this.repo.findByName(workspaceId, input.name)) throw nameTaken(input.name);
    try {
      const row = await this.repo.inTransaction((repo) =>
        repo.insert(
          {
            workspaceId,
            name: input.name,
            description: input.description,
            type: input.type,
            source: input.source ?? 'manual',
            body: input.body,
            enabled: input.enabled ?? true,
          },
          INITIAL_VERSION_NOTE,
        ),
      );
      return this.dto(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw nameTaken(input.name);
      throw err;
    }
  }

  async update(workspaceId: string, id: string, input: UpdateSkillInput): Promise<Skill> {
    try {
      const row = await this.repo.inTransaction(async (repo) => {
        const existing = await repo.getByIdForUpdate(workspaceId, id);
        if (!existing) throw new NotFoundError('Skill not found');

        if (input.name !== undefined && input.name !== existing.name) {
          if (await repo.findByName(workspaceId, input.name)) throw nameTaken(input.name);
        }
        const fields = {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        };
        let current = existing;
        if (Object.keys(fields).length > 0) current = await repo.updateFields(workspaceId, id, fields);

        // Only a changed body is a new version — toggling `enabled` or fixing the
        // description must not pollute the history evals are reproduced against.
        if (input.body !== undefined && input.body !== existing.body) {
          current = await repo.writeBodyVersion(
            workspaceId,
            id,
            input.body,
            existing.version + 1,
            input.change_note || DEFAULT_UPDATE_NOTE,
          );
        }
        return current;
      });
      return this.dto(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw nameTaken(input.name ?? '');
      throw err;
    }
  }

  /**
   * Create the skill, or — when one with this name exists — write the input as
   * its next version. Lets a generated skill (e.g. `repo-conventions`) be
   * refreshed in place instead of failing on the name clash.
   */
  async upsertByName(workspaceId: string, input: CreateSkillInput, changeNote: string): Promise<Skill> {
    const existing = await this.repo.findByName(workspaceId, input.name);
    if (!existing) return this.create(workspaceId, input);
    return this.update(workspaceId, existing.id, {
      description: input.description,
      type: input.type,
      body: input.body,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      change_note: changeNote,
    });
  }

  /** The skill named `name`, or null — for callers that offer to overwrite it. */
  async findByName(workspaceId: string, name: string): Promise<Skill | null> {
    const row = await this.repo.findByName(workspaceId, name);
    return row ? this.dto(row) : null;
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    if (!(await this.repo.deleteById(workspaceId, id))) throw new NotFoundError('Skill not found');
  }

  async versions(workspaceId: string, id: string): Promise<SkillVersion[]> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) throw new NotFoundError('Skill not found');
    const rows = await this.repo.listVersions(id);
    const out = rows.map((r) => toSkillVersionDto(r, skill.version));
    // Skills created before versioning existed have no snapshot of the current body.
    if (!out.some((v) => v.current)) {
      out.unshift({
        version: skill.version,
        body: skill.body,
        message: INITIAL_VERSION_NOTE,
        created_at: skill.createdAt.toISOString(),
        current: true,
      });
    }
    return out;
  }

  /** History is append-only: restoring vN writes a NEW version with vN's body. */
  async restore(workspaceId: string, id: string, version: number): Promise<Skill> {
    const row = await this.repo.inTransaction(async (repo) => {
      const existing = await repo.getByIdForUpdate(workspaceId, id);
      if (!existing) throw new NotFoundError('Skill not found');
      if (version === existing.version) throw new ConflictError('That version is already current');
      const old = await repo.getVersion(id, version);
      if (!old) throw new NotFoundError('Version not found');
      return repo.writeBodyVersion(
        workspaceId,
        id,
        old.body,
        existing.version + 1,
        `Restored from v${version}`,
      );
    });
    return this.dto(row);
  }

  async statsFor(workspaceId: string, id: string): Promise<SkillStats> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) throw new NotFoundError('Skill not found');
    const s = await this.stats.statsFor(workspaceId, id);
    return {
      used_by: s.usedBy.map((u) => ({ agent_id: u.agentId, name: u.name, enabled: u.enabled })),
      pull_rate: rate(s.runsWithSkill, s.runs),
      accept_rate: rate(s.accepted, s.accepted + s.dismissed),
      findings_30d: s.findingsByCategory.reduce((n, c) => n + c.count, 0),
      findings_by_category: s.findingsByCategory,
    };
  }

  /** Parse an uploaded file into an editable preview. Writes NOTHING. */
  async importPreview(workspaceId: string, req: SkillImportRequest): Promise<SkillImportPreview> {
    const preview = buildImportPreview(req.filename, new Uint8Array(Buffer.from(req.content_base64, 'base64')));
    const conflict = await this.repo.findByName(workspaceId, preview.name);
    return { ...preview, name_conflict: Boolean(conflict) };
  }
}
