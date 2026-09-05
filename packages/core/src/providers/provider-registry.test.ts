import { test, describe, expect, vi } from 'vitest';
import os from 'node:os';
import { eq } from 'drizzle-orm';
import { ProviderRegistry } from './provider-registry.js';
import type { ProviderLauncher } from './registry/provider-launcher.js';
import type { BinaryInstaller } from './registry/binary-installer.js';
import { noopLogger } from '../logger.js';
import type { RegistryAgent } from '@agentctl/shared';
import { createDatabase } from '../db/index.js';
import { providers, registrySnapshots } from '../db/schema.js';

describe('ProviderRegistry', () => {
  test('ProviderRegistry discover returns providers from DB', async () => {
    const db = createDatabase(':memory:');

    await db.insert(providers).values({
      id: 'claude-acp',
      name: 'Claude Code',
      installState: 'installed_local',
      authState: 'authenticated',
      command: 'claude',

      launchArgs: '[]',
      launchEnv: '{}',
      customEnv: '{}',
      configOptions: '[]',
      authMethods: '[]',
      version: '1.0.0',
      description: 'test',
      icon: 'icon',
      createdAt: new Date(),
      updatedAt: new Date(),
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    });

    const registry = new ProviderRegistry(db, noopLogger);
    const providersList = await registry.discover();

    expect(providersList.length).toBe(1);
    expect(providersList[0].id).toBe('claude-acp');
    expect(providersList[0].installState).toBe('installed_local');
    expect(providersList[0].authState).toBe('authenticated');
  });

  test('ProviderRegistry getProvider returns specific provider from DB', async () => {
    const db = createDatabase(':memory:');

    await db.insert(providers).values({
      id: 'claude-acp',
      name: 'Claude Code',
      installState: 'installed_local',
      authState: 'authenticated',
      command: 'claude',

      launchArgs: '[]',
      launchEnv: '{}',
      customEnv: '{}',
      configOptions: '[]',
      authMethods: '[]',
      version: '1.0.0',
      description: 'test',
      icon: 'icon',
      createdAt: new Date(),
      updatedAt: new Date(),
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    });

    const registry = new ProviderRegistry(db, noopLogger);
    const provider = registry.getProvider('claude-acp');

    expect(provider).toBeDefined();
    expect(provider?.id).toBe('claude-acp');
  });

  test('install persists provider with system_available state and enables it', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);
    const reg = registry as unknown as { launcher: ProviderLauncher };
    const launcherSpy = vi.spyOn(reg.launcher, 'isBinaryOnPath').mockResolvedValue(true);
    const probeSpy = vi.spyOn(reg.launcher, 'probe').mockResolvedValue({
      status: 'ready',
      configOptions: [],
      authMethods: [],
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    });
    const agent: RegistryAgent = {
      id: 'npx-agent',
      name: 'NPX Agent',
      version: '1.2.3',
      description: 'distributed via npx',
      authors: [],
      distribution: { npx: { package: 'npx-agent-pkg', args: ['--foo'], env: { BAR: 'baz' } } },
    };
    await db.insert(registrySnapshots).values({
      data: JSON.stringify({ version: '1', agents: [agent] }),
      fetchedAt: new Date(),
    });

    const result = await registry.install('npx-agent');

    expect(result.id).toBe('npx-agent');
    expect(result.installState).toBe('system_available');
    expect(result.command).toBe('npx');
    launcherSpy.mockRestore();
    probeSpy.mockRestore();
  }, 30000);

  test('remove resets provider to not_installed and disables it', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);
    const reg = registry as unknown as { launcher: ProviderLauncher };
    const launcherSpy = vi.spyOn(reg.launcher, 'isBinaryOnPath').mockResolvedValue(true);
    const probeSpy = vi.spyOn(reg.launcher, 'probe').mockResolvedValue({
      status: 'ready',
      configOptions: [],
      authMethods: [],
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    });
    const agent: RegistryAgent = {
      id: 'npx-agent',
      name: 'NPX Agent',
      version: '1.2.3',
      description: 'distributed via npx',
      authors: [],
      distribution: { npx: { package: 'npx-agent-pkg', args: [], env: {} } },
    };
    await db.insert(registrySnapshots).values({
      data: JSON.stringify({ version: '1', agents: [agent] }),
      fetchedAt: new Date(),
    });
    await registry.install('npx-agent');

    const result = await registry.remove('npx-agent');

    expect(result.installState).toBe('not_installed');
    launcherSpy.mockRestore();
    probeSpy.mockRestore();
  }, 30000);

  test('concurrent install dedupes to a single installer run', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);
    const agent: RegistryAgent = {
      id: 'dup-agent',
      name: 'Dup',
      version: '1.0.0',
      description: 'dup',
      authors: [],
      distribution: { npx: { package: 'dup-pkg', args: [], env: {} } },
    };
    await db
      .insert(registrySnapshots)
      .values({ data: JSON.stringify({ version: '1', agents: [agent] }), fetchedAt: new Date() });

    const reg = registry as unknown as { installer: BinaryInstaller; launcher: ProviderLauncher };
    const spy = vi.spyOn(reg, 'installer', 'get').mockImplementationOnce(
      () =>
        ({
          install: vi.fn(() => ({ command: 'npx', args: [], env: {} })),
          remove: vi.fn(() => undefined),
          isInstalled: vi.fn(() => true),
        }) as unknown as BinaryInstaller,
    );

    const launcherSpy = vi.spyOn(reg.launcher, 'isBinaryOnPath').mockResolvedValue(true);
    const probeSpy = vi.spyOn(reg.launcher, 'probe').mockResolvedValue({
      status: 'ready',
      configOptions: [],
      authMethods: [],
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    });

    const [a, b] = await Promise.all([
      registry.install('dup-agent'),
      registry.install('dup-agent'),
    ]);
    expect(launcherSpy).toHaveBeenCalledTimes(1);
    expect(a.id).toBe('dup-agent');
    expect(b.id).toBe('dup-agent');
    spy.mockRestore();
    launcherSpy.mockRestore();
    probeSpy.mockRestore();
  }, 15000);

  test('install falls back to npx when no binary for current platform', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);
    const agent: RegistryAgent = {
      id: 'fb-agent',
      name: 'Fallback',
      version: '1.0.0',
      description: 'fallback',
      authors: [],
      distribution: {
        binary: {
          'darwin-aarch64': { archive: 'https://x.com/a.tar.gz', cmd: 'bin', args: [], env: {} },
        },
        npx: { package: 'fb-pkg', args: [], env: {} },
      },
    };
    await db
      .insert(registrySnapshots)
      .values({ data: JSON.stringify({ version: '1', agents: [agent] }), fetchedAt: new Date() });
    const platformSpy = vi.spyOn(os, 'platform').mockReturnValue('linux');
    const archSpy = vi.spyOn(os, 'arch').mockReturnValue('x64');
    const reg = registry as unknown as { launcher: ProviderLauncher };
    const launcherSpy = vi.spyOn(reg.launcher, 'isBinaryOnPath').mockResolvedValue(true);
    const probeSpy = vi.spyOn(reg.launcher, 'probe').mockResolvedValue({
      status: 'ready',
      configOptions: [],
      authMethods: [],
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    });
    try {
      const res = await registry.install('fb-agent');
      expect(res.installState).toBe('system_available');
      expect(res.command).toBe('npx');
    } finally {
      platformSpy.mockRestore();
      archSpy.mockRestore();
      launcherSpy.mockRestore();
      probeSpy.mockRestore();
    }
  }, 30000);

  test('install throws when binary-only and platform unsupported', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);
    const agent: RegistryAgent = {
      id: 'no-agent',
      name: 'No',
      version: '1.0.0',
      description: 'no',
      authors: [],
      distribution: {
        binary: {
          'darwin-aarch64': { archive: 'https://x.com/a.tar.gz', cmd: 'bin', args: [], env: {} },
        },
      },
    };
    await db
      .insert(registrySnapshots)
      .values({ data: JSON.stringify({ version: '1', agents: [agent] }), fetchedAt: new Date() });
    const platformSpy = vi.spyOn(os, 'platform').mockReturnValue('linux');
    const archSpy = vi.spyOn(os, 'arch').mockReturnValue('x64');
    try {
      await expect(registry.install('no-agent')).rejects.toThrow(/not available for platform/);
    } finally {
      platformSpy.mockRestore();
      archSpy.mockRestore();
    }
  });

  test('ensureProviderReady installs when installState is not_installed', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);
    const agent: RegistryAgent = {
      id: 'lazy-agent',
      name: 'Lazy',
      version: '1.0.0',
      authors: [],
      description: '',
      distribution: { npx: { package: 'lazy-pkg', args: [], env: {} } },
    };
    await db.insert(registrySnapshots).values({
      data: JSON.stringify({ version: '1.0.0', agents: [agent] }),
      fetchedAt: new Date(),
    });
    const regF = registry as unknown as { fetcher: { fetch: () => Promise<RegistryAgent[]> } };
    const fetchSpy = vi.spyOn(regF.fetcher, 'fetch').mockResolvedValue([agent]);
    await registry.sync();
    const reg = registry as unknown as { launcher: ProviderLauncher };
    const launcherSpy = vi.spyOn(reg.launcher, 'isBinaryOnPath').mockResolvedValue(true);
    const probeSpy = vi.spyOn(reg.launcher, 'probe').mockResolvedValue({
      status: 'ready',
      configOptions: [],
      authMethods: [],
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    });
    try {
      const spy = vi.spyOn(registry, 'install');
      const res = await registry.ensureProviderReady('lazy-agent');
      expect(spy).toHaveBeenCalledWith('lazy-agent');
      expect(res.installState).toBe('system_available');
    } finally {
      launcherSpy.mockRestore();
      probeSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  }, 15000);

  test('npx launch args use range-bound version spec', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);
    const agent: RegistryAgent = {
      id: 'range-agent',
      name: 'Range',
      version: '1.2.3',
      authors: [],
      description: '',
      distribution: { npx: { package: 'range-pkg', args: ['--x'], env: {} } },
    };
    await db
      .insert(registrySnapshots)
      .values({ data: JSON.stringify({ version: '1', agents: [agent] }), fetchedAt: new Date() });
    const reg = registry as unknown as { launcher: ProviderLauncher };
    const launcherSpy = vi.spyOn(reg.launcher, 'isBinaryOnPath').mockResolvedValue(true);
    const probeSpy = vi.spyOn(reg.launcher, 'probe').mockResolvedValue({
      status: 'ready',
      configOptions: [],
      authMethods: [],
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    });
    try {
      const res = await registry.install('range-agent');
      expect(res.launchArgs).toEqual(['-y', 'range-pkg@1.2.3', '--x']);
    } finally {
      launcherSpy.mockRestore();
      probeSpy.mockRestore();
    }
  }, 15000);

  test('sync preserves existing dynamically probed configOptions', async () => {
    const db = createDatabase(':memory:');
    const probedOptions = [
      {
        id: 'model',
        name: 'Model',
        type: 'select',
        currentValue: 'claude-3-7-sonnet',
        options: [{ value: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet' }],
      },
    ];

    await db.insert(providers).values({
      id: 'claude-acp',
      name: 'Claude Code',
      installState: 'installed_local',
      authState: 'authenticated',
      command: 'claude',
      launchArgs: '[]',
      launchEnv: '{}',
      customEnv: '{}',
      configOptions: JSON.stringify(probedOptions),
      authMethods: '[]',
      version: '1.0.0',
      description: 'test',
      icon: 'icon',
      createdAt: new Date(),
      updatedAt: new Date(),
      supportsDynamicModel: true,
      supportsDynamicConfig: true,
    });

    const staticAgent: RegistryAgent = {
      id: 'claude-acp',
      name: 'Claude Code Updated',
      version: '1.0.1',
      description: 'updated description',
      authors: [],
      distribution: { npx: { package: 'claude', args: [], env: {} } },
      configOptions: [], // Static registry has empty configOptions
    };

    await db.insert(registrySnapshots).values({
      data: JSON.stringify({ version: '1', agents: [staticAgent] }),
      fetchedAt: new Date(),
    });

    const registry = new ProviderRegistry(db, noopLogger);
    const fetchSpy = vi
      .spyOn(
        (registry as unknown as { fetcher: { fetch: () => Promise<RegistryAgent[]> } }).fetcher,
        'fetch',
      )
      .mockResolvedValue([staticAgent]);

    try {
      await registry.sync();
      const provider = registry.getProvider('claude-acp');
      expect(provider).toBeDefined();
      const discovery = provider?.toDiscovery();
      // Should preserve the probed models, not overwrite with empty []
      expect(discovery?.configOptions).toEqual(probedOptions);
      expect(discovery?.supportsDynamicModel).toBe(true);
      expect(discovery?.version).toBe('1.0.1');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('refreshProvider on not_installed provider updates metadata without spawning probe', async () => {
    const db = createDatabase(':memory:');

    await db.insert(providers).values({
      id: 'codex-acp',
      name: 'Codex',
      installState: 'not_installed',
      authState: 'authenticated',
      command: 'npx',
      launchArgs: '[]',
      launchEnv: '{}',
      customEnv: '{}',
      configOptions: '[]',
      authMethods: '[]',
      version: '1.0.0',
      description: 'Old desc',
      icon: 'icon',
      createdAt: new Date(),
      updatedAt: new Date(),
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    });

    const staticAgent: RegistryAgent = {
      id: 'codex-acp',
      name: 'Codex',
      version: '1.1.0',
      description: 'New desc',
      authors: [],
      distribution: { npx: { package: '@agentclientprotocol/codex-acp@1.1.0', args: [], env: {} } },
      configOptions: [],
    };

    await db.insert(registrySnapshots).values({
      data: JSON.stringify({ version: '1', agents: [staticAgent] }),
      fetchedAt: new Date(),
    });

    const registry = new ProviderRegistry(db, noopLogger);
    const launcherSpy = vi.spyOn(
      (registry as unknown as { launcher: { probe: () => Promise<unknown> } }).launcher,
      'probe',
    );

    const result = await registry.refreshProvider('codex-acp');
    expect(result.id).toBe('codex-acp');
    expect(result.version).toBe('1.1.0');
    expect(result.description).toBe('New desc');
    expect(result.installState).toBe('not_installed');
    // Probe should never have been invoked
    expect(launcherSpy).not.toHaveBeenCalled();
  });

  test('setProviderConfig on not_installed provider updates env without spawning probe', async () => {
    const db = createDatabase(':memory:');

    await db.insert(providers).values({
      id: 'codex-acp',
      name: 'Codex',
      installState: 'not_installed',
      authState: 'authenticated',
      command: 'npx',
      launchArgs: '[]',
      launchEnv: '{}',
      customEnv: '{}',
      configOptions: '[]',
      authMethods: '[]',
      version: '1.0.0',
      description: 'Desc',
      icon: 'icon',
      createdAt: new Date(),
      updatedAt: new Date(),
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    });

    const staticAgent: RegistryAgent = {
      id: 'codex-acp',
      name: 'Codex',
      version: '1.0.0',
      description: 'Desc',
      authors: [],
      distribution: { npx: { package: '@agentclientprotocol/codex-acp@1.0.0', args: [], env: {} } },
    };

    await db.insert(registrySnapshots).values({
      data: JSON.stringify({ version: '1', agents: [staticAgent] }),
      fetchedAt: new Date(),
    });

    const registry = new ProviderRegistry(db, noopLogger);
    const launcherSpy = vi.spyOn(
      (registry as unknown as { launcher: { probe: () => Promise<unknown> } }).launcher,
      'probe',
    );

    const result = await registry.setProviderConfig('codex-acp', {
      customEnv: { OPENAI_API_KEY: 'sk-test' },
    });
    expect(result.id).toBe('codex-acp');
    expect(result.customEnvConfigured).toEqual({ OPENAI_API_KEY: true });
    expect(launcherSpy).not.toHaveBeenCalled();
  });

  test('install records failed state and error message when probe fails', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);
    const agent: RegistryAgent = {
      id: 'probe-fail-agent',
      name: 'Probe Fail Agent',
      version: '1.0.0',
      description: 'Will fail probe',
      authors: [],
      distribution: { npx: { package: 'fail-pkg', args: [], env: {} } },
    };
    await db.insert(registrySnapshots).values({
      data: JSON.stringify({ version: '1', agents: [agent] }),
      fetchedAt: new Date(),
    });

    const reg = registry as unknown as { launcher: ProviderLauncher };
    const launcherSpy = vi.spyOn(reg.launcher, 'isBinaryOnPath').mockResolvedValue(true);
    const probeSpy = vi
      .spyOn(reg.launcher, 'probe')
      .mockRejectedValue(new Error('Process exited with code 127'));

    await expect(registry.install('probe-fail-agent')).rejects.toThrow(
      /Failed to verify agent installation/,
    );

    const row = db.select().from(providers).where(eq(providers.id, 'probe-fail-agent')).all()[0];
    expect(row).toBeDefined();
    expect(row.installState).toBe('failed');
    expect(row.installError).toContain('Process exited with code 127');

    launcherSpy.mockRestore();
    probeSpy.mockRestore();
  });

  test('install auto-detects system binary when executable is found on PATH', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);
    const agent: RegistryAgent = {
      id: 'local-agent',
      name: 'Local Agent',
      version: '1.0.0',
      description: 'Agent already in path',
      authors: [],
      distribution: {
        binary: {
          'linux-x86_64': {
            archive: 'https://x.com/a.tar.gz',
            cmd: './local-bin',
            args: ['--acp'],
            env: {},
          },
        },
      },
    };
    await db.insert(registrySnapshots).values({
      data: JSON.stringify({ version: '1', agents: [agent] }),
      fetchedAt: new Date(),
    });

    const platformSpy = vi.spyOn(os, 'platform').mockReturnValue('linux');
    const archSpy = vi.spyOn(os, 'arch').mockReturnValue('x64');
    const reg = registry as unknown as { launcher: ProviderLauncher; installer: BinaryInstaller };
    const launcherSpy = vi
      .spyOn(reg.launcher, 'isBinaryOnPath')
      .mockImplementation(async (cmd) => cmd === 'local-bin');
    const installerSpy = vi.spyOn(reg.installer, 'install');
    const probeSpy = vi.spyOn(reg.launcher, 'probe').mockResolvedValue({
      status: 'ready',
      configOptions: [],
      authMethods: [],
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    });

    try {
      const res = await registry.install('local-agent');
      expect(res.installState).toBe('system_available');
      expect(res.command).toBe('local-bin');
      expect(res.launchArgs).toEqual(['--acp']);
      expect(installerSpy).not.toHaveBeenCalled();
    } finally {
      platformSpy.mockRestore();
      archSpy.mockRestore();
      launcherSpy.mockRestore();
      installerSpy.mockRestore();
      probeSpy.mockRestore();
    }
  });
});
