/**
 * intent public facade — what the composition root may import from intent.
 *
 * The service is reached through `container.intent` (the review run executor
 * calls `container.intent.forRun(...)`), so `reviews` never imports this module
 * and `intent → reviews` stays a one-way edge. The routes plugin is registered
 * by `modules/index.ts` and is not re-exported here.
 */
export {
  IntentService,
  createIntentService,
  type IntentDeps,
  type IntentLog,
  type IntentPort,
  type RunIntent,
} from './service.js';

// Reference parsing the brief reuses (one PR-body parser, not two).
export { issueText, parseReferences, type PrSelf } from './helpers.js';
