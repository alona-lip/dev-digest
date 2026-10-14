import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  SettingsUpdate,
  ConnTestRequest,
  type ConnTestResult,
  type SecretsStatus,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { SettingsService } from './service.js';

/**
 * F1 — settings module. Transport only; the logic lives in SettingsService.
 *   GET  /settings                 → current non-secret prefs
 *   PUT  /settings                 → upsert prefs (key/value rows)
 *   GET  /settings/secrets-status  → which provider keys are set (booleans)
 *   POST /settings/test-connection → test a provider key (OpenAI/Anthropic/OpenRouter/GitHub)
 *
 * Secrets are NOT stored in `settings` — only non-secret prefs. Keys go
 * through SecretsProvider.
 */
export default async function settingsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new SettingsService(container.settingsRepo, container);

  app.get('/settings', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.get(workspaceId);
  });

  // Which provider keys are configured (booleans only — the values are NEVER
  // returned). Drives the "Configured / Not set" badges in the API Keys panel.
  app.get('/settings/secrets-status', async (req): Promise<SecretsStatus> => {
    await getContext(container, req);
    return service.secretsStatus();
  });

  app.put('/settings', { schema: { body: SettingsUpdate } }, async (req) => {
    const { workspaceId, userId } = await getContext(container, req);
    return service.update(workspaceId, userId, req.body);
  });

  app.post(
    '/settings/test-connection',
    {
      schema: { body: ConnTestRequest },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req): Promise<ConnTestResult> => service.testConnection(req.body.provider, req.body.key),
  );
}
