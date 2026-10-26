import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import type { BlastLog } from './service.js';

/** pino's `(obj, msg)` → the service's `(msg, data)` log. */
const toBlastLog = (log: FastifyBaseLogger): BlastLog => ({
  info: (msg, data) => log.info(data ?? {}, msg),
  warn: (msg, data) => log.warn(data ?? {}, msg),
});

/**
 * Blast module — what else in the repo a PR's change reaches.
 *   GET /pulls/:id/blast → PrBlastRadius (a cheap indexed read; the global rate limit applies)
 *   GET /pulls/:id/blast/history → PrHistory (merged PRs that touched the changed files; one GitHub call)
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get('/pulls/:id/blast', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return app.container.blast.forPull(workspaceId, req.params.id, toBlastLog(req.log));
  });

  // Every call spends a GitHub GraphQL request, so it is capped like the other
  // externally-backed routes (intent), not only by the global limit.
  app.get(
    '/pulls/:id/blast/history',
    { schema: { params: IdParams }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
    const { workspaceId } = await getContext(app.container, req);
      return app.container.blast.history(workspaceId, req.params.id, toBlastLog(req.log));
    },
  );
}
