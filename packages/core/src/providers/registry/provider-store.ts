import { eq } from 'drizzle-orm';
import { providers, systemSettings } from '../../db/schema.js';
import type { DbClient } from '../../db/index.js';
import type { ProviderData } from '../provider.js';
import type { InstallSource, InstallStage, InstallState } from '@agentctl/shared';

export class ProviderStore {
  constructor(private db: DbClient) {}

  get(id: string): ProviderData | undefined {
    const rows = this.db.select().from(providers).where(eq(providers.id, id)).all();
    return rows.length > 0 ? rows[0] : undefined;
  }

  list(): ProviderData[] {
    return this.db.select().from(providers).where(eq(providers.hidden, false)).all();
  }

  listAll(): ProviderData[] {
    return this.db.select().from(providers).all();
  }

  upsert(id: string, values: Partial<typeof providers.$inferInsert>): void {
    const existing = this.get(id);
    if (existing) {
      this.db
        .update(providers)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(providers.id, id))
        .run();
    } else {
      this.db
        .insert(providers)
        .values({
          id,
          name: values.name ?? id,
          command: values.command ?? id,
          ...values,
        })
        .run();
    }
  }

  update(id: string, values: Partial<typeof providers.$inferInsert>): void {
    this.db
      .update(providers)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(providers.id, id))
      .run();
  }

  delete(id: string): void {
    this.db.delete(providers).where(eq(providers.id, id)).run();
  }

  setInstallState(id: string, state: InstallState, error?: string | null): void {
    const updateValues: Partial<typeof providers.$inferInsert> = { installState: state };
    if (error !== undefined) {
      updateValues.installError = error;
    }
    this.update(id, updateValues);
  }

  setInstallDetails(
    id: string,
    details: {
      state?: InstallState;
      stage?: InstallStage | null;
      source?: InstallSource | null;
      installedVersion?: string | null;
      error?: string | null;
    },
  ): void {
    this.update(id, {
      ...(details.state !== undefined ? { installState: details.state } : {}),
      ...(details.stage !== undefined ? { installStage: details.stage } : {}),
      ...(details.source !== undefined ? { installSource: details.source } : {}),
      ...(details.installedVersion !== undefined
        ? { installedVersion: details.installedVersion }
        : {}),
      ...(details.error !== undefined ? { installError: details.error } : {}),
    });
  }

  setAuthState(id: string, state: ProviderData['authState']): void {
    this.update(id, { authState: state === 'needs_auth' ? 'required' : state });
  }

  setAuthDetails(
    id: string,
    details: {
      authState?: ProviderData['authState'];
      connectionState?: ProviderData['connectionState'];
      authError?: string | null;
      lastVerifiedAt?: Date | null;
    },
  ): void {
    const updateValues: Partial<typeof providers.$inferInsert> = {
      ...(details.authState !== undefined
        ? { authState: details.authState === 'needs_auth' ? 'required' : details.authState }
        : {}),
      ...(details.connectionState !== undefined
        ? { connectionState: details.connectionState }
        : {}),
      ...(details.authError !== undefined ? { authError: details.authError } : {}),
      ...(details.lastVerifiedAt !== undefined ? { lastVerifiedAt: details.lastVerifiedAt } : {}),
    };
    this.update(id, updateValues);
  }

  setCustomEnv(id: string, env: Record<string, string>): void {
    this.update(id, { customEnv: JSON.stringify(env) });
  }

  setDefaultConfigOptions(id: string, options: unknown[]): void {
    this.update(id, { configOptions: JSON.stringify(options) });
  }

  getSetting(key: string): string | undefined {
    const rows = this.db.select().from(systemSettings).where(eq(systemSettings.key, key)).all();
    return rows.length > 0 ? rows[0].value : undefined;
  }

  updateSetting(key: string, value: string): void {
    const existing = this.getSetting(key);
    if (existing !== undefined) {
      this.db.update(systemSettings).set({ value }).where(eq(systemSettings.key, key)).run();
    } else {
      this.db.insert(systemSettings).values({ key, value }).run();
    }
  }

  deleteSetting(key: string): void {
    this.db.delete(systemSettings).where(eq(systemSettings.key, key)).run();
  }

  getDefaultProviderId(): string | undefined {
    return this.getSetting('defaultProviderId');
  }

  setDefaultProviderId(id: string): void {
    this.updateSetting('defaultProviderId', id);
  }
}
