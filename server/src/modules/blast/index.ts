/**
 * blast public facade — what the composition root may import from blast.
 * The service is reached through `container.blast`; the routes plugin is
 * registered by `modules/index.ts` and is not re-exported here.
 */
export {
  BlastService,
  createBlastService,
  type BlastDeps,
  type BlastLog,
  type BlastPort,
} from './service.js';
