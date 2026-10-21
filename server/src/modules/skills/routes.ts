import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CreateSkillInput, SkillImportRequest, SkillImportUrlRequest, UpdateSkillInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SkillsService } from './service.js';

const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

/**
 * Skills module — reusable, text-only prompt skills.
 *   GET    /skills                                   → list + rollups
 *   GET    /skills/:id                               → one skill
 *   POST   /skills                                   → create (v1)
 *   PUT    /skills/:id                               → update (new body → new version)
 *   DELETE /skills/:id                               → delete (unlinks from every agent)
 *   GET    /skills/:id/versions                      → body snapshots, newest first
 *   POST   /skills/:id/versions/:version/restore     → new version with that body
 *   GET    /skills/:id/stats                         → usage + accept rate (30d)
 *   POST   /skills/:id/rescan                        → pattern + LLM injection scan, stores the result
 *   POST   /skills/import/preview                    → parse .md/.zip, saves NOTHING
 *   POST   /skills/import/url-preview                → fetch an https URL server-side, parse it, saves NOTHING
 */
export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.get(workspaceId, req.params.id);
  });

  app.post('/skills', { schema: { body: CreateSkillInput } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    reply.code(201);
    return service.create(workspaceId, req.body);
  });

  app.put('/skills/:id', { schema: { params: IdParams, body: UpdateSkillInput } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.update(workspaceId, req.params.id, req.body);
  });

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.remove(workspaceId, req.params.id);
    return { ok: true };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.versions(workspaceId, req.params.id);
  });

  app.post(
    '/skills/:id/versions/:version/restore',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.restore(workspaceId, req.params.id, req.params.version);
    },
  );

  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.statsFor(workspaceId, req.params.id);
  });

  app.post('/skills/:id/rescan', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.rescan(workspaceId, req.params.id);
  });

  app.post('/skills/import/preview', { schema: { body: SkillImportRequest } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.importPreview(workspaceId, req.body);
  });

  app.post('/skills/import/url-preview', { schema: { body: SkillImportUrlRequest } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.importUrlPreview(workspaceId, req.body);
  });
}
