import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { providers } from '../db/schema.js';
import type { DbClient } from '../db/index.js';
import { jsonCodecs } from '../db/json-codecs.js';

const VAULT_REF_PREFIX = 'vault:';

export interface CredentialVaultOptions {
  vaultDir?: string;
  vaultFile?: string;
  keyFile?: string;
}

export class CredentialVault {
  private vaultPath: string;
  private keyPath: string;
  private masterKey: Buffer | null = null;
  private cache: Map<string, string> = new Map();
  private loaded = false;

  constructor(options: CredentialVaultOptions = {}) {
    const baseDir =
      options.vaultDir ??
      (process.env.NODE_ENV === 'test'
        ? path.join(os.tmpdir(), `agentctl-test-vault-${process.pid.toString()}`)
        : (process.env.AGENTCTL_HOME ?? path.join(os.homedir(), '.agentctl')));
    this.vaultPath = options.vaultFile ?? path.join(baseDir, 'credentials.vault');
    this.keyPath = options.keyFile ?? path.join(baseDir, '.vault-key');
  }

  private ensureDirectory(): void {
    for (const dir of new Set([path.dirname(this.vaultPath), path.dirname(this.keyPath)])) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(dir, 0o700);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EROFS') throw error;
        }
      }
    }
  }

  private getMasterKey(): Buffer {
    if (this.masterKey) return this.masterKey;

    this.ensureDirectory();
    if (fs.existsSync(this.keyPath)) {
      const keyHex = fs.readFileSync(this.keyPath, 'utf8').trim();
      if (!/^[a-f0-9]{64}$/i.test(keyHex)) {
        throw new Error(`Credential vault key is invalid: ${this.keyPath}`);
      }
      if (process.platform !== 'win32') fs.chmodSync(this.keyPath, 0o600);
      this.masterKey = Buffer.from(keyHex, 'hex');
      return this.masterKey;
    }

    // Generate a secure 256-bit master key
    this.masterKey = crypto.randomBytes(32);
    fs.writeFileSync(this.keyPath, this.masterKey.toString('hex'), {
      mode: 0o600,
      encoding: 'utf8',
      flag: 'wx',
    });
    return this.masterKey;
  }

  private loadVault(): void {
    if (this.loaded) return;
    if (!fs.existsSync(this.vaultPath)) {
      this.loaded = true;
      return;
    }

    try {
      const encryptedBlob = fs.readFileSync(this.vaultPath);
      if (encryptedBlob.length < 28) {
        throw new Error('Credential vault is truncated');
      }

      const iv = encryptedBlob.subarray(0, 12);
      const tag = encryptedBlob.subarray(12, 28);
      const ciphertext = encryptedBlob.subarray(28);

      const decipher = crypto.createDecipheriv('aes-256-gcm', this.getMasterKey(), iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const data = JSON.parse(decrypted.toString('utf8')) as Record<string, string>;

      for (const [k, v] of Object.entries(data)) {
        this.cache.set(k, v);
      }
      if (process.platform !== 'win32') fs.chmodSync(this.vaultPath, 0o600);
      this.loaded = true;
    } catch (error) {
      this.cache.clear();
      throw new Error(`Failed to decrypt credential vault at ${this.vaultPath}`, { cause: error });
    }
  }

  private persistVault(): void {
    this.ensureDirectory();
    const data: Record<string, string> = {};
    for (const [k, v] of this.cache.entries()) {
      data[k] = v;
    }

    const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.getMasterKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const output = Buffer.concat([iv, tag, ciphertext]);
    const tempPath = `${this.vaultPath}.${process.pid.toString()}.tmp`;
    fs.writeFileSync(tempPath, output, { mode: 0o600 });
    fs.renameSync(tempPath, this.vaultPath);
    if (process.platform !== 'win32') fs.chmodSync(this.vaultPath, 0o600);
  }

  isSecretRef(val: string): boolean {
    return typeof val === 'string' && val.startsWith(VAULT_REF_PREFIX);
  }

  createSecretRef(providerId: string, key: string): string {
    return `${VAULT_REF_PREFIX}provider:${providerId}:${key}`;
  }

  async getSecret(ref: string): Promise<string | null> {
    this.loadVault();
    return this.cache.get(ref) ?? null;
  }

  getSecretSync(ref: string): string | null {
    this.loadVault();
    return this.cache.get(ref) ?? null;
  }

  async setSecret(providerId: string, key: string, value: string): Promise<string> {
    this.loadVault();
    const ref = this.createSecretRef(providerId, key);
    this.cache.set(ref, value);
    this.persistVault();
    return ref;
  }

  /** Apply a provider's secret changes with a single encrypted-file replacement. */
  async setProviderSecrets(
    providerId: string,
    updates: Record<string, string | null>,
  ): Promise<Record<string, string>> {
    this.loadVault();
    const refs: Record<string, string> = {};
    let modified = false;
    for (const [key, value] of Object.entries(updates)) {
      const ref = this.createSecretRef(providerId, key);
      if (value === null) {
        modified = this.cache.delete(ref) || modified;
      } else {
        this.cache.set(ref, value);
        refs[key] = ref;
        modified = true;
      }
    }
    if (modified) this.persistVault();
    return refs;
  }

  snapshotProviderSecrets(providerId: string): Record<string, string> {
    this.loadVault();
    const prefix = `${VAULT_REF_PREFIX}provider:${providerId}:`;
    return Object.fromEntries(
      Array.from(this.cache.entries()).filter(([ref]) => ref.startsWith(prefix)),
    );
  }

  async restoreProviderSecrets(
    providerId: string,
    snapshot: Record<string, string>,
  ): Promise<void> {
    this.loadVault();
    const prefix = `${VAULT_REF_PREFIX}provider:${providerId}:`;
    for (const ref of Array.from(this.cache.keys())) {
      if (ref.startsWith(prefix)) this.cache.delete(ref);
    }
    for (const [ref, value] of Object.entries(snapshot)) this.cache.set(ref, value);
    this.persistVault();
  }

  async deleteSecret(ref: string): Promise<void> {
    this.loadVault();
    if (this.cache.delete(ref)) {
      this.persistVault();
    }
  }

  async deleteProviderSecrets(providerId: string): Promise<void> {
    this.loadVault();
    const prefix = `${VAULT_REF_PREFIX}provider:${providerId}:`;
    let modified = false;
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        modified = true;
      }
    }
    if (modified) {
      this.persistVault();
    }
  }

  async resolveEnv(env: Record<string, string>): Promise<Record<string, string>> {
    this.loadVault();
    const resolved: Record<string, string> = {};
    for (const [key, val] of Object.entries(env)) {
      if (this.isSecretRef(val)) {
        const secret = this.cache.get(val);
        if (secret === undefined) throw new Error(`Credential vault reference is missing: ${val}`);
        resolved[key] = secret;
      } else {
        resolved[key] = val;
      }
    }
    return resolved;
  }

  resolveEnvSync(env: Record<string, string>): Record<string, string> {
    this.loadVault();
    const resolved: Record<string, string> = {};
    for (const [key, val] of Object.entries(env)) {
      if (this.isSecretRef(val)) {
        const secret = this.cache.get(val);
        if (secret === undefined) throw new Error(`Credential vault reference is missing: ${val}`);
        resolved[key] = secret;
      } else {
        resolved[key] = val;
      }
    }
    return resolved;
  }

  async migratePlaintextCustomEnv(db: DbClient): Promise<{ migratedCount: number }> {
    this.loadVault();
    const rows = db.select().from(providers).all();
    let migratedCount = 0;
    const rowUpdates: Array<{ id: string; customEnv: string }> = [];

    for (const row of rows) {
      const envRecord = jsonCodecs.stringRecord(row.customEnv);
      let changed = false;
      const nextEnvRecord: Record<string, string> = {};

      for (const [key, val] of Object.entries(envRecord)) {
        if (val && !this.isSecretRef(val)) {
          const ref = this.createSecretRef(row.id, key);
          this.cache.set(ref, val);
          nextEnvRecord[key] = ref;
          changed = true;
          migratedCount++;
        } else {
          nextEnvRecord[key] = val;
        }
      }

      if (changed) {
        rowUpdates.push({ id: row.id, customEnv: JSON.stringify(nextEnvRecord) });
      }
    }

    if (migratedCount > 0) {
      // Persist secrets before replacing plaintext with references. A crash or
      // database error can leave harmless orphaned vault entries, but never a
      // database reference whose secret was not durably written.
      this.persistVault();
      for (const update of rowUpdates) {
        db.update(providers)
          .set({ customEnv: update.customEnv })
          .where(eq(providers.id, update.id))
          .run();
      }
    }

    return { migratedCount };
  }
}

export const defaultCredentialVault = new CredentialVault();
