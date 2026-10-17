import { eq } from 'drizzle-orm';
import { providers } from '../db/schema.js';
import type { DbClient } from '../db/index.js';
import { jsonCodecs } from '../db/json-codecs.js';
import type { CredentialStore } from './credential-store.js';

/** Explicit startup migration: persist every secret before publishing database references. */
export async function migrateProviderCredentials(
  db: DbClient,
  credentials: Pick<CredentialStore, 'isSecretRef' | 'setProviderSecrets'>,
): Promise<{ migratedCount: number }> {
  const updates: Array<{ id: string; customEnv: string }> = [];
  let migratedCount = 0;
  for (const row of db.select().from(providers).all()) {
    const env = jsonCodecs.stringRecord(row.customEnv);
    const plaintext = Object.fromEntries(
      Object.entries(env).filter(([, value]) => value && !credentials.isSecretRef(value)),
    );
    if (!Object.keys(plaintext).length) continue;
    const refs = await credentials.setProviderSecrets(row.id, plaintext);
    updates.push({ id: row.id, customEnv: JSON.stringify({ ...env, ...refs }) });
    migratedCount += Object.keys(plaintext).length;
  }
  // Failure can leave harmless orphaned secrets. A reference never precedes its durable secret.
  db.transaction((tx) => {
    for (const update of updates)
      tx.update(providers)
        .set({ customEnv: update.customEnv })
        .where(eq(providers.id, update.id))
        .run();
  });
  return { migratedCount };
}
