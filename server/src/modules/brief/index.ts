/**
 * brief public facade — what the composition root may import from brief.
 * The service is reached through `container.brief`; the routes plugin is
 * registered by `modules/index.ts` and is not re-exported here.
 */
export {
  BriefService,
  createBriefService,
  type BriefDeps,
  type BriefLog,
  type BriefPort,
} from './service.js';
