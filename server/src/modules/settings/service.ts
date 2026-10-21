import type {
  ConnTestProvider,
  ConnTestResult,
  SecretsStatus,
  Settings,
  SettingsUpdate,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { GITHUB_PROVIDER, SECRET_KEY_BY_PROVIDER } from './constants.js';
import { rowsToSettings } from './helpers.js';
import type { SettingsRepository } from './repository.js';

/**
 * What the connection test needs from the composition root: the secrets store,
 * the stored-key clients, throwaway candidate-key clients, and cache reset.
 * Named explicitly so the dependency is visible (not the whole Container).
 */
export type ConnectionDeps = Pick<
  Container,
  'secrets' | 'github' | 'llm' | 'probeGitHub' | 'probeLlm' | 'invalidateSecretCaches'
>;

/** Non-secret workspace prefs + provider connection checks. */
export class SettingsService {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly deps: ConnectionDeps,
  ) {}

  async get(workspaceId: string): Promise<Settings> {
    return rowsToSettings(await this.repo.list(workspaceId));
  }

  async update(workspaceId: string, userId: string, body: SettingsUpdate): Promise<Settings> {
    await this.repo.upsert(workspaceId, userId, Object.entries(body));
    return this.get(workspaceId);
  }

  /** Which provider keys are configured — booleans only, the values are NEVER returned. */
  async secretsStatus(): Promise<SecretsStatus> {
    const entries = await Promise.all(
      (Object.entries(SECRET_KEY_BY_PROVIDER) as [keyof SecretsStatus, string][]).map(
        async ([provider, key]) => [provider, Boolean(await this.deps.secrets.get(key))] as const,
      ),
    );
    return Object.fromEntries(entries) as SecretsStatus;
  }

  /**
   * Cheap live call per provider (GET user / list models). A key from the UI
   * (BYO key) is tested as a CANDIDATE first and only persisted once the call
   * succeeds — a typo must not overwrite the working key the rest of the app
   * uses. No key → test the stored one.
   */
  async testConnection(provider: ConnTestProvider, key?: string): Promise<ConnTestResult> {
    const { deps } = this;
    try {
      if (key && !deps.secrets.set) {
        return { provider, ok: false, message: 'Secrets backend is read-only' };
      }
      let message: string;
      if (provider === GITHUB_PROVIDER) {
        const gh = key ? deps.probeGitHub(key) : await deps.github();
        message = `Connected as @${await gh.currentLogin()}`;
      } else {
        const llm = key ? deps.probeLlm(provider, key) : await deps.llm(provider);
        message = `OK — ${(await llm.listModels()).length} models available`;
      }
      if (key) {
        await deps.secrets.set!(SECRET_KEY_BY_PROVIDER[provider], key);
        deps.invalidateSecretCaches();
      }
      return { provider, ok: true, message };
    } catch (err) {
      return { provider, ok: false, message: (err as Error).message };
    }
  }
}
