import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ContextAttachmentsInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';

const RepoParams = z.object({ repoId: z.string().uuid() });
const AgentParams = z.object({ agentId: z.string().uuid() });
const SkillParams = z.object({ skillId: z.string().uuid() });
const FileQuery = z.object({ path: z.string().min(1) });
const OwnerQuery = z.object({ repo_id: z.string().uuid() });

/**
 * Project context — repo `.md` documents attachable to agents and skills.
 *   GET      /repos/:repoId/context            → ContextDocList
 *   GET      /repos/:repoId/context/file?path= → ContextDocContent (404 · 413 too_large)
 *   GET      /repos/:repoId/context/usage      → ContextUsage
 *   GET/PUT  /agents/:agentId/context          → ContextAttachments (?repo_id= / body)
 *   GET/PUT  /skills/:skillId/context          → ContextAttachments (?repo_id= / body)
 */
export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get('/repos/:repoId/context', { schema: { params: RepoParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return app.container.projectContext.listDocs(workspaceId, req.params.repoId);
  });

  app.get(
    '/repos/:repoId/context/file',
    { schema: { params: RepoParams, querystring: FileQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.projectContext.readDoc(workspaceId, req.params.repoId, req.query.path);
    },
  );

  app.get('/repos/:repoId/context/usage', { schema: { params: RepoParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return app.container.projectContext.usage(workspaceId, req.params.repoId);
  });

  app.get(
    '/agents/:agentId/context',
    { schema: { params: AgentParams, querystring: OwnerQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.projectContext.getAttachments(
        'agent',
        workspaceId,
        req.params.agentId,
        req.query.repo_id,
      );
    },
  );

  app.put(
    '/agents/:agentId/context',
    { schema: { params: AgentParams, body: ContextAttachmentsInput } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.projectContext.replaceAttachments('agent', workspaceId, req.params.agentId, req.body);
    },
  );

  app.get(
    '/skills/:skillId/context',
    { schema: { params: SkillParams, querystring: OwnerQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.projectContext.getAttachments(
        'skill',
        workspaceId,
        req.params.skillId,
        req.query.repo_id,
      );
    },
  );

  app.put(
    '/skills/:skillId/context',
    { schema: { params: SkillParams, body: ContextAttachmentsInput } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.projectContext.replaceAttachments('skill', workspaceId, req.params.skillId, req.body);
    },
  );
}
