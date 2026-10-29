/**
 * project-context public facade — what the composition root may import.
 * The service is reached through `container.projectContext`; the routes plugin is
 * registered by `modules/index.ts` and is not re-exported here.
 */
export {
  createProjectContextService,
  type ProjectContextPort,
  type ProjectContextDeps,
  type ForRunInput,
  type RunContext,
} from './service.js';
