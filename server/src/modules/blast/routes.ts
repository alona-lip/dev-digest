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
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get('/pulls/:id/blast', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return app.container.blast.forPull(workspaceId, req.params.id, toBlastLog(req.log));
  });
}
