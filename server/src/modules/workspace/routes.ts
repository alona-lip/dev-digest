import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { toWorkspaceRepoSummary } from './helpers.js';

/**
 * F1 — workspace manager: where clones live + a summary of cloned repos.
 *   GET /workspace        → workspace info + cloneDir + cloned repos summary
 *
 * Cleanup/re-pull of individual repos is handled by the repos module
 * (refresh/delete); this surface gives the UI an overview.
 */
export default async function workspaceRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/workspace', async (req) => {
    const { workspaceId } = await getContext(container, req);
    const repos = await container.reposRepo.list(workspaceId);
    return {
      workspaceId,
      cloneDir: container.config.cloneDir,
      repos: repos.map(toWorkspaceRepoSummary),
    };
  });
}
