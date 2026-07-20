import { eq } from 'drizzle-orm';
import { providers, systemSettings } from '../../db/schema.js';
import type { DbClient } from '../acp-session.js';

export class ProviderStore {
  constructor(private db: DbClient) {}

  get(id: string): typeof providers.$inferSelect | undefined {
    const rows = this.db.select().from(providers).where(eq(providers.id, id)).all();
    return rows[0];
  }

  list() {
    return this.db.select().from(providers).where(eq(providers.hidden, false)).all();
  }

  listAll() {
    return this.db.select().from(providers).all();
  }

  upsert(id: string, fields: Partial<typeof providers.$inferInsert>) {
    const existing = this.get(id);
    if (existing) {
      this.db
        .update(providers)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(providers.id, id))
        .run();
    } else {
      this.db
        .insert(providers)
        .values({
          id,
          name: fields.name ?? id,
          command: fields.command ?? id,
          ...fields,
        })
        .run();
    }
    return this.get(id);
  }

  update(id: string, partial: Partial<typeof providers.$inferInsert>) {
    return this.upsert(id, partial);
  }

  setInstallState(id: string, state: 'not_installed' | 'installed_local' | 'system_available') {
    this.update(id, { installState: state });
  }

  setAuthState(id: string, state: 'unknown' | 'authenticated' | 'needs_auth' | 'error') {
    this.update(id, { authState: state });
  }

  setEnabled(id: string, enabled: boolean) {
    this.update(id, { enabled });
    if (!enabled) {
      const defaultId = this.getDefaultProviderId();
      if (defaultId === id) {
        const next = this.list().find((p) => p.enabled && p.id !== id);
        this.setDefaultProviderId(next?.id ?? '');
      }
    }
  }

  setCustomEnv(id: string, env: Record<string, string>) {
    this.update(id, { customEnv: JSON.stringify(env) });
  }

  hide(id: string) {
    this.update(id, { hidden: true });
  }

  unhide(id: string) {
    this.update(id, { hidden: false });
  }

  delete(id: string) {
    this.db.delete(providers).where(eq(providers.id, id)).run();
  }

  getSetting(key: string): string | undefined {
    const row = this.db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, key))
      .all()[0] as typeof systemSettings.$inferSelect | undefined;
    return row?.value;
  }

  updateSetting(key: string, value: string) {
    this.db
      .insert(systemSettings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, updatedAt: new Date() },
      })
      .run();
  }

  getDefaultProviderId(): string | undefined {
    return this.getSetting('defaultProviderId');
  }

  setDefaultProviderId(id: string) {
    this.updateSetting('defaultProviderId', id);
  }

  deleteSetting(key: string) {
    this.db.delete(systemSettings).where(eq(systemSettings.key, key)).run();
  }

  setDefaultConfigOptions(id: string, options: unknown[]) {
    this.update(id, { configOptions: JSON.stringify(options) });
  }

  setConfigOptions(id: string, options: unknown[]) {
    this.update(id, { configOptions: JSON.stringify(options) });
  }
}
