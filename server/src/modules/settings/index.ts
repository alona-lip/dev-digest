/**
 * settings public facade — what OTHER modules may import from settings.
 *
 * System LLM features resolve their provider/model here (Settings → Feature
 * Models), never from a hardcoded constant.
 */
export { resolveFeatureModel, defaultFeatureModel } from './feature-models.js';
