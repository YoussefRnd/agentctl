import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { CredentialStore } from './credential-store.js';

const VAULT_REF_PREFIX = 'vault:';

export interface CredentialVaultOptions {
  vaultDir?: string;
  vaultFile?: string;
  keyFile?: string;
}

export class CredentialVault implements CredentialStore {
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
    const key = crypto.randomBytes(32);
    fs.writeFileSync(this.keyPath, key.toString('hex'), {
      mode: 0o600,
      encoding: 'utf8',
      flag: 'wx',
    });
    this.masterKey = key;
    return key;
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

  private persistVault(cache: ReadonlyMap<string, string>): void {
    this.ensureDirectory();
    const data: Record<string, string> = {};
    for (const [k, v] of cache.entries()) {
      data[k] = v;
    }

    const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.getMasterKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const output = Buffer.concat([iv, tag, ciphertext]);
    const tempPath = `${this.vaultPath}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tempPath, output, { mode: 0o600 });
      fs.renameSync(tempPath, this.vaultPath);
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
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

  private write<T>(mutate: (candidate: Map<string, string>) => T): T {
    this.loadVault();
    const candidate = new Map(this.cache);
    const result = mutate(candidate);
    if (
      candidate.size === this.cache.size &&
      [...candidate].every(([key, value]) => this.cache.get(key) === value)
    )
      return result;
    this.persistVault(candidate);
    this.cache = candidate;
    return result;
  }

  async setSecret(providerId: string, key: string, value: string): Promise<string> {
    const ref = this.createSecretRef(providerId, key);
    this.write((candidate) => candidate.set(ref, value));
    return ref;
  }

  async setProviderSecrets(
    providerId: string,
    updates: Record<string, string | null>,
  ): Promise<Record<string, string>> {
    return this.write((candidate) => {
      const refs: Record<string, string> = {};
      for (const [key, value] of Object.entries(updates)) {
        const ref = this.createSecretRef(providerId, key);
        if (value === null) candidate.delete(ref);
        else {
          candidate.set(ref, value);
          refs[key] = ref;
        }
      }
      return refs;
    });
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
    const prefix = `${VAULT_REF_PREFIX}provider:${providerId}:`;
    this.write((candidate) => {
      for (const ref of candidate.keys()) if (ref.startsWith(prefix)) candidate.delete(ref);
      for (const [ref, value] of Object.entries(snapshot)) {
        if (!ref.startsWith(prefix)) throw new Error('Secret snapshot belongs to another provider');
        candidate.set(ref, value);
      }
    });
  }

  async deleteSecret(ref: string): Promise<void> {
    this.write((candidate) => candidate.delete(ref));
  }
  async deleteProviderSecrets(providerId: string): Promise<void> {
    await this.restoreProviderSecrets(providerId, {});
  }

  async resolveEnv(env: Record<string, string>): Promise<Record<string, string>> {
    return this.resolveEnvSync(env);
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
}
