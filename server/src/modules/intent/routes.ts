import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import type { IntentLog } from './service.js';

/** pino's `(obj, msg)` → the service's `(msg, data)` progress log. */
const toIntentLog = (log: FastifyBaseLogger): IntentLog => ({
  info: (msg, data) => log.info(data ?? {}, msg),
});

/**
 * Intent module — a PR's derived purpose and scope (Intent Layer).
 *   GET  /pulls/:id/intent            → stored intent, or compute + store it now (Overview load)
 *   POST /pulls/:id/intent/recompute  → always recompute (one LLM call — rate limited)
 *
 * Both can cost a model call, so both get a per-route cap below the global
 * 120/min. The GET's is looser: it is also the cheap read on every PR open
 * (the client caches it for 30s), and opening a run of PRs must not 429.
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/pulls/:id/intent',
    { schema: { params: IdParams }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.intent.getOrCompute(workspaceId, req.params.id, toIntentLog(req.log));
    },
  );

  app.post(
    '/pulls/:id/intent/recompute',
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.intent.recompute(workspaceId, req.params.id, toIntentLog(req.log));
    },
  );
}
