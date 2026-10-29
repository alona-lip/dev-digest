import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import type { BriefLog } from './service.js';

/** pino's `(obj, msg)` → the service's `(msg, data)` progress log. */
const toBriefLog = (log: FastifyBaseLogger): BriefLog => ({
  info: (msg, data) => log.info(data ?? {}, msg),
  warn: (msg, data) => log.warn(data ?? {}, msg),
});

/**
 * Brief module — the generated PR brief (summary, risks, review focus).
 *   GET  /pulls/:id/brief  → stored brief + staleness, or `{status:'none'}` (never calls a model)
 *   POST /pulls/:id/brief  → generate now (one LLM call — 10/min per client), store, return it
 *
 * Only the POST gets the per-route cap: the GET is the free read on every PR open and must not 429.
 *
 * Errors: 404 unknown PR · 422 `no_changed_files` / `brief_input_too_large` · 429 rate limit ·
 * 502 changed files or model unreachable / invalid output.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.brief.read(workspaceId, req.params.id, toBriefLog(req.log));
    },
  );

  app.post(
    '/pulls/:id/brief',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.brief.generate(workspaceId, req.params.id, toBriefLog(req.log));
    },
  );
}
