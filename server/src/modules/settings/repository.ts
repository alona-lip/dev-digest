import { eq } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SettingsRow } from './helpers.js';

/**
 * Settings data access — non-secret workspace prefs as key/value rows. API keys
 * are NOT here (they go through SecretsProvider). Shared with the per-feature
 * model resolution (`feature-models.ts`) through `container.settingsRepo`.
 */
export class SettingsRepository {
  constructor(private db: Executor) {}

  list(workspaceId: string): Promise<SettingsRow[]> {
    return this.db
      .select({ key: t.settings.key, value: t.settings.value })
      .from(t.settings)
      .where(eq(t.settings.workspaceId, workspaceId));
  }

  /** Upsert each key for (workspace, user) — one transaction, so a partial save can't happen. */
  upsert(workspaceId: string, userId: string, entries: [string, unknown][]): Promise<void> {
    return this.db.transaction(async (tx) => {
      for (const [key, value] of entries) {
        await tx
          .insert(t.settings)
          .values({ workspaceId, userId, key, value })
          .onConflictDoUpdate({
            target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
            set: { value },
          });
      }
    });
  }
}
