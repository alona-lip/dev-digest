import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  BulkConventionStatusInput,
  CreateConventionSkillInput,
  UpdateConventionInput,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { createConventionsService } from './service.js';

/**
 * Conventions module — house rules extracted from a repo, triaged, merged into a skill.
 *   GET   /repos/:id/conventions              → candidates (PENDING + ACCEPTED; REJECTED hidden)
 *   POST  /repos/:id/conventions/extract      → scan: sample → one LLM call → evidence gate
 *   PATCH /repos/:id/conventions              → one status for many ("Deselect all")
 *   PATCH /conventions/:id                    → accept / reject / edit rule + category
 *   GET   /repos/:id/conventions/skill-draft  → skill built from ACCEPTED, writes nothing
 *   POST  /repos/:id/conventions/skill        → save skill (new or next version) + link agent
 */
export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = createConventionsService(app.container);

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.post('/repos/:id/conventions/extract', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.extract(workspaceId, req.params.id);
  });

  app.patch(
    '/repos/:id/conventions',
    { schema: { params: IdParams, body: BulkConventionStatusInput } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setStatusMany(workspaceId, req.params.id, req.body);
    },
  );

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionInput } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.update(workspaceId, req.params.id, req.body);
    },
  );

  app.get('/repos/:id/conventions/skill-draft', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.skillDraft(workspaceId, req.params.id);
  });

  app.post(
    '/repos/:id/conventions/skill',
    { schema: { params: IdParams, body: CreateConventionSkillInput } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      reply.code(201);
      return service.createSkill(workspaceId, req.params.id, req.body);
    },
  );
}
