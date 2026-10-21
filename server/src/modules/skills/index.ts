/**
 * skills public facade — what OTHER modules may import from skills.
 *
 * Other modules write skills through `SkillsService` (e.g. conventions saves
 * `repo-conventions` via `upsertByName`), never through the repository, so
 * versioning and the name-clash rules stay in one place. The routes plugin is
 * registered by `modules/index.ts` and is not re-exported here.
 */
export { SkillsService } from './service.js';
/** Pure prompt-injection scan — the run executor re-checks every skill body with it. */
export { scanSkillBody } from './helpers.js';
