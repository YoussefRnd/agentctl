import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CredentialVault } from './credential-vault.js';
import { createDatabase } from '../db/index.js';
import { providers } from '../db/schema.js';

describe('CredentialVault', () => {
  let tmpDir: string;
  let vault: CredentialVault;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
    vault = new CredentialVault({
      vaultDir: tmpDir,
      vaultFile: path.join(tmpDir, 'test.vault'),
      keyFile: path.join(tmpDir, 'test.key'),
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores and retrieves secrets using encryption', async () => {
    const ref = await vault.setSecret('test-provider', 'API_KEY', 'sk-super-secret-123');
    expect(vault.isSecretRef(ref)).toBe(true);
    expect(ref).toBe('vault:provider:test-provider:API_KEY');

    const retrieved = await vault.getSecret(ref);
    expect(retrieved).toBe('sk-super-secret-123');

    const syncRetrieved = vault.getSecretSync(ref);
    expect(syncRetrieved).toBe('sk-super-secret-123');

    // Verify file on disk is encrypted and does not contain plaintext secret
    const rawVaultBytes = fs.readFileSync(path.join(tmpDir, 'test.vault'));
    expect(rawVaultBytes.includes(Buffer.from('sk-super-secret-123'))).toBe(false);
  });

  it('persists across distinct CredentialVault instances with same key', async () => {
    const ref = await vault.setSecret('provider-a', 'TOKEN', 'tok_abc456');

    // Create a new instance pointing to the same files
    const vault2 = new CredentialVault({
      vaultDir: tmpDir,
      vaultFile: path.join(tmpDir, 'test.vault'),
      keyFile: path.join(tmpDir, 'test.key'),
    });

    const retrieved = await vault2.getSecret(ref);
    expect(retrieved).toBe('tok_abc456');
  });

  it('resolves env records containing vault references and preserves plaintext', async () => {
    const ref1 = await vault.setSecret('provider-b', 'KEY1', 'val1');
    const ref2 = await vault.setSecret('provider-b', 'KEY2', 'val2');

    const unresolved = {
      KEY1: ref1,
      KEY2: ref2,
      PLAIN: 'plaintext-val',
    };

    const resolved = await vault.resolveEnv(unresolved);
    expect(resolved).toEqual({
      KEY1: 'val1',
      KEY2: 'val2',
      PLAIN: 'plaintext-val',
    });

    const resolvedSync = vault.resolveEnvSync(unresolved);
    expect(resolvedSync).toEqual(resolved);
  });

  it('fails closed when a vault reference is missing', async () => {
    await expect(vault.resolveEnv({ TOKEN: 'vault:provider:fake:MISSING' })).rejects.toThrow(
      'Credential vault reference is missing',
    );
    expect(() => vault.resolveEnvSync({ TOKEN: 'vault:provider:fake:MISSING' })).toThrow(
      'Credential vault reference is missing',
    );
  });

  it('deletes specific secrets and provider-scoped secrets', async () => {
    const ref1 = await vault.setSecret('provider-c', 'KEY1', 'v1');
    const ref2 = await vault.setSecret('provider-c', 'KEY2', 'v2');
    const otherRef = await vault.setSecret('other-provider', 'KEY1', 'other-v');

    await vault.deleteSecret(ref1);
    expect(await vault.getSecret(ref1)).toBeNull();
    expect(await vault.getSecret(ref2)).toBe('v2');

    await vault.deleteProviderSecrets('provider-c');
    expect(await vault.getSecret(ref2)).toBeNull();
    expect(await vault.getSecret(otherRef)).toBe('other-v');
  });

  it('migrates plaintext customEnv from SQLite to vault references', async () => {
    const dbPath = path.join(tmpDir, 'test.db');
    const db = createDatabase(dbPath);

    db.insert(providers)
      .values({
        id: 'legacy-provider',
        name: 'Legacy Provider',
        command: 'legacy',
        installState: 'installed_local',
        authState: 'required',
        distribution: '{}',
        launchArgs: '[]',
        launchEnv: '{}',
        customEnv: JSON.stringify({
          ANTHROPIC_API_KEY: 'sk-ant-test-plaintext',
          PUBLIC_VAR: 'already_public',
        }),
        configOptions: '[]',
        authMethods: '[]',
      })
      .run();

    const { migratedCount } = await vault.migratePlaintextCustomEnv(db);
    expect(migratedCount).toBe(2);

    const updatedRow = db.select().from(providers).all()[0];
    const updatedEnv = JSON.parse(updatedRow.customEnv) as Record<string, string>;

    expect(vault.isSecretRef(updatedEnv.ANTHROPIC_API_KEY)).toBe(true);
    expect(vault.isSecretRef(updatedEnv.PUBLIC_VAR)).toBe(true);

    expect(await vault.getSecret(updatedEnv.ANTHROPIC_API_KEY)).toBe('sk-ant-test-plaintext');
    expect(await vault.getSecret(updatedEnv.PUBLIC_VAR)).toBe('already_public');
  });
});
