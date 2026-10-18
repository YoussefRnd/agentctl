import { test, describe, expect, vi } from 'vite-plus/test';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { ProviderRegistry } from './provider-registry.js';
import type { ProviderLauncher } from './registry/provider-launcher.js';
import type { BinaryInstaller } from './registry/binary-installer.js';
import { noopLogger } from '../logger.js';
import type { ProviderDiscovery, RegistryAgent } from '@agentctl/shared';
import { createDatabase } from '../db/index.js';
import { providers, registrySnapshots } from '../db/schema.js';
import { getDefaultCredentialVault } from '../default-credential-vault.js';

describe('ProviderRegistry', () => {
  test('automatic updates target only enabled, installed, app-managed providers and continue after a failure', async () => {
    const db = createDatabase(':memory:');
    await db.insert(providers).values([
      {
        id: 'managed',
        name: 'Managed',
        command: 'managed',
        installState: 'installed_local',
        installSource: 'managed',
        installedVersion: '1.0.0',
        version: '2.0.0',
      },
      {
        id: 'npx',
        name: 'Npx',
        command: 'npx',
        installState: 'system_available',
        installSource: 'npx',
        installedVersion: '1.0.0',
        version: '2.0.0',
      },
      {
        id: 'uvx',
        name: 'Uvx',
        command: 'uvx',
        installState: 'system_available',
        installSource: 'uvx',
        installedVersion: '1.0.0',
        version: '2.0.0',
      },
      {
        id: 'system',
        name: 'System',
        command: 'system',
        installState: 'system_available',
        installSource: 'system',
        installedVersion: '1.0.0',
        version: '2.0.0',
      },
      {
        id: 'disabled',
        name: 'Disabled',
        command: 'disabled',
        installState: 'installed_local',
        installSource: 'managed',
        installedVersion: '1.0.0',
        version: '2.0.0',
        enabled: false,
      },
      {
        id: 'current',
        name: 'Current',
        command: 'current',
        installState: 'installed_local',
        installSource: 'managed',
        installedVersion: '2.0.0',
        version: '2.0.0',
      },
      {
        id: 'older-catalog',
        name: 'Older catalog',
        command: 'older',
        installState: 'installed_local',
        installSource: 'managed',
        installedVersion: '2.0.0',
        version: '1.0.0',
      },
      {
        id: 'preview',
        name: 'Preview',
        command: 'preview',
        installState: 'installed_local',
        installSource: 'managed',
        installedVersion: '1.0.0',
        version: '2.0.0-beta.1',
      },
      {
        id: 'absent',
        name: 'Absent',
        command: 'absent',
        installState: 'not_installed',
        installSource: 'npx',
        installedVersion: '1.0.0',
        version: '2.0.0',
      },
    ]);

    const registry = new ProviderRegistry(db, noopLogger);
    const install = vi.spyOn(registry, 'install').mockImplementation(async (id) => {
      if (id === 'managed') throw new Error('download failed');
      return { id, updateAvailable: false, installedVersion: '2.0.0' } as ProviderDiscovery;
    });

    await registry.autoUpdateInstalledProviders();

    expect(install.mock.calls).toEqual([
      ['managed', { prewarmNpx: true }],
      ['npx', { prewarmNpx: true }],
      ['uvx', { prewarmNpx: true }],
    ]);

    const restartedRegistry = new ProviderRegistry(db, noopLogger);
    const retry = vi.spyOn(restartedRegistry, 'install').mockResolvedValue({
      updateAvailable: false,
      installedVersion: '2.0.0',
    } as ProviderDiscovery);
    await restartedRegistry.autoUpdateInstalledProviders();
    expect(retry.mock.calls.map(([id]) => id)).toEqual(['npx', 'uvx']);
  });

  test('prunes stale npx caches while preserving the active cache', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-npx-cache-'));
    const previousHome = process.env.AGENTCTL_HOME;
    process.env.AGENTCTL_HOME = home;
    try {
      const cacheRoot = path.join(home, 'provider-npx-cache');
      const active = path.join(cacheRoot, `${'a'.repeat(20)}-ABC123`);
      const stale = path.join(cacheRoot, `${'b'.repeat(20)}-DEF456`);
      await fs.mkdir(active, { recursive: true });
      await fs.mkdir(stale, { recursive: true });
      const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await fs.utimes(active, old, old);
      await fs.utimes(stale, old, old);
      const db = createDatabase(':memory:');
      await db.insert(providers).values({
        id: 'cached-agent',
        name: 'Cached Agent',
        command: 'npx',
        installState: 'system_available',
        installSource: 'npx',
        installedVersion: '1.0.0',
        version: '1.0.0',
        launchEnv: JSON.stringify({ npm_config_cache: active }),
      });

      await new ProviderRegistry(db, noopLogger).autoUpdateInstalledProviders();

      await expect(fs.stat(active)).resolves.toBeDefined();
      await expect(fs.stat(stale)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      if (previousHome === undefined) delete process.env.AGENTCTL_HOME;
      else process.env.AGENTCTL_HOME = previousHome;
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  test('keeps a valid installed managed binary when the catalog advances', async () => {
    const db = createDatabase(':memory:');
    const agent: RegistryAgent = {
      id: 'managed-ready',
      name: 'Managed Ready',
      version: '2.0.0',
      description: '',
      authors: [],
      distribution: {
        binary: {
          'linux-x86_64': {
            archive: 'https://example.com/managed-ready-2.tar.gz',
            cmd: 'managed-ready',
            env: {},
          },
        },
      },
    };
    await db.insert(registrySnapshots).values({
      data: JSON.stringify({ version: '1', agents: [agent] }),
      fetchedAt: new Date(),
    });
    await db.insert(providers).values({
      id: agent.id,
      name: agent.name,
      command: '/managed/old/managed-ready',
      installState: 'installed_local',
      installSource: 'managed',
      installedVersion: '1.0.0',
      version: '2.0.0',
      authState: 'not_required',
      connectionState: 'ready',
    });

    const registry = new ProviderRegistry(db, noopLogger);
    const { installer } = registry as unknown as { installer: BinaryInstaller };
    const isInstalledCommand = vi.spyOn(installer, 'isInstalledCommand').mockReturnValue(true);
    const install = vi.spyOn(registry, 'install');

    const provider = await registry.ensureProviderReady(agent.id);

    expect(isInstalledCommand).toHaveBeenCalledWith(agent.id, '/managed/old/managed-ready');
    expect(install).not.toHaveBeenCalled();
    expect(provider.installState).toBe('installed_local');
    expect(registry.getProvider(agent.id)?.toDiscovery().updateAvailable).toBe(true);
  });

  test('installs the local override when its id also exists in the remote snapshot', async () => {
    const overrideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-registry-override-'));
    const previousPath = process.env.AGENTCTL_REGISTRY_PATH;
    const overridePath = path.join(overrideDir, 'registry.json');
    const remoteAgent: RegistryAgent = {
      id: 'overridden-agent',
      name: 'Remote Agent',
      version: '1.0.0',
      description: '',
      authors: [],
      distribution: { npx: { package: 'remote-agent', args: [], env: {} } },
    };
    const localAgent: RegistryAgent = {
      ...remoteAgent,
      name: 'Local Agent',
      version: '2.0.0',
      distribution: { npx: { package: 'local-agent', args: [], env: {} } },
    };
    try {
      await fs.writeFile(overridePath, JSON.stringify({ version: 'local', agents: [localAgent] }));
      process.env.AGENTCTL_REGISTRY_PATH = overridePath;
      const db = createDatabase(':memory:');
      await db.insert(registrySnapshots).values({
        data: JSON.stringify({ version: '1', agents: [remoteAgent] }),
        fetchedAt: new Date(),
      });
      const registry = new ProviderRegistry(db, noopLogger);
      const { fetcher, launcher } = registry as unknown as {
        fetcher: { fetch: () => Promise<RegistryAgent[]> };
        launcher: ProviderLauncher;
      };
      vi.spyOn(fetcher, 'fetch').mockResolvedValue([localAgent]);
      vi.spyOn(launcher, 'isBinaryOnPath').mockResolvedValue(true);
      vi.spyOn(launcher, 'inspectLaunch').mockResolvedValue({
        status: 'ready',
        configOptions: [],
        authMethods: [],
        supportsDynamicModel: false,
        supportsDynamicConfig: false,
      });

      await registry.sync();
      const installed = await registry.install(localAgent.id, { prewarmNpx: false });

      expect(installed.launchArgs).toContain('local-agent@2.0.0');
      expect(installed.launchArgs).not.toContain('remote-agent@1.0.0');
    } finally {
      if (previousPath === undefined) delete process.env.AGENTCTL_REGISTRY_PATH;
      else process.env.AGENTCTL_REGISTRY_PATH = previousPath;
      await fs.rm(overrideDir, { recursive: true, force: true });
    }
  });

  test('catalog and provider reads do not fetch, sync, probe, or publish state', async () => {
    const db = createDatabase(':memory:');
    const agent: RegistryAgent = {
      id: 'offline-agent',
      name: 'Offline Agent',
      version: '1.0.0',
      description: '',
      authors: [],
      distribution: {},
    };
    await db.insert(registrySnapshots).values({
      data: JSON.stringify({ version: '1', agents: [agent] }),
      fetchedAt: new Date(),
    });
    await db.insert(providers).values({
      id: agent.id,
      name: agent.name,
      command: 'offline-agent',
      installState: 'installed_local',
      authState: 'unknown',
      configOptions: '[]',
    });

    const registry = new ProviderRegistry(db, noopLogger);
    const { fetcher, launcher } = registry as unknown as {
      fetcher: { fetch: () => Promise<RegistryAgent[]> };
      launcher: ProviderLauncher;
    };
    const fetch = vi.spyOn(fetcher, 'fetch');
    const sync = vi.spyOn(registry, 'sync');
    const probe = vi.spyOn(launcher, 'probe');
    const onStateChange = vi.fn();
    registry.setOnStateChange(onStateChange);

    for (let index = 0; index < 3; index++) {
      expect((await registry.catalog()).some((provider) => provider.id === agent.id)).toBe(true);
      expect((await registry.discover()).some((provider) => provider.id === agent.id)).toBe(true);
    }

    expect(fetch).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(onStateChange).not.toHaveBeenCalled();
  });

  test('catalog falls back to persisted providers when no snapshot exists', async () => {
    const db = createDatabase(':memory:');
    await db.insert(providers).values({
      id: 'saved-agent',
      name: 'Saved Agent',
      command: 'saved-agent',
      installState: 'installed_local',
    });

    const registry = new ProviderRegistry(db, noopLogger);
    const { fetcher } = registry as unknown as {
      fetcher: { fetch: () => Promise<RegistryAgent[]> };
    };
    const fetch = vi.spyOn(fetcher, 'fetch');

    expect((await registry.catalog()).map((provider) => provider.id)).toContain('saved-agent');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('does not launch a placeholder editor command while an agent is installing', async () => {
    const db = createDatabase(':memory:');
    const agent: RegistryAgent = {
      id: 'cursor',
      name: 'Cursor',
      version: '1.0.0',
      description: '',
      authors: [],
      distribution: {},
    };
    await db.insert(registrySnapshots).values({
      data: JSON.stringify({ version: '1', agents: [agent] }),
      fetchedAt: new Date(),
    });
    await db.insert(providers).values({
      id: 'cursor',
      name: 'Cursor',
      command: 'cursor',
      installState: 'installing',
      installStage: 'downloading',
      authState: 'unknown',
    });

    const registry = new ProviderRegistry(db, noopLogger);
    const { launcher } = registry as unknown as { launcher: ProviderLauncher };
    const probe = vi.spyOn(launcher, 'probe');

    await registry.discover();
    await registry.probeAllInstalledProviders();
    await registry.refreshProvider('cursor');

    expect(probe).not.toHaveBeenCalled();
  });

  test('install persists provider with system_available state and enables it', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);
    const reg = registry as unknown as { launcher: ProviderLauncher };
    const launcherSpy = vi.spyOn(reg.launcher, 'isBinaryOnPath').mockResolvedValue(true);
    const probeSpy = vi.spyOn(reg.launcher, 'inspectLaunch').mockResolvedValue({
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

    const result = await registry.install('npx-agent', { prewarmNpx: false });

    expect(result.id).toBe('npx-agent');
    expect(result.installState).toBe('system_available');
    expect(result.command).toBe('npx');
    launcherSpy.mockRestore();
    probeSpy.mockRestore();
  }, 30000);

  test('reinstall preserves encrypted environment references', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);
    const agent: RegistryAgent = {
      id: 'configured-agent',
      name: 'Configured Agent',
      version: '2.0.0',
      description: '',
      authors: [],
      distribution: { npx: { package: 'configured-agent', args: [], env: {} } },
    };
    await db.insert(registrySnapshots).values({
      data: JSON.stringify({ version: '1', agents: [agent] }),
      fetchedAt: new Date(),
    });
    const secretRef = await getDefaultCredentialVault().setSecret(
      agent.id,
      'API_KEY',
      'configured-secret',
    );
    await db.insert(providers).values({
      id: agent.id,
      name: agent.name,
      command: 'npx',
      installState: 'system_available',
      installSource: 'npx',
      installedVersion: '1.0.0',
      authState: 'authenticated',
      customEnv: JSON.stringify({ API_KEY: secretRef }),
    });
    const internals = registry as unknown as { launcher: ProviderLauncher };
    vi.spyOn(internals.launcher, 'isBinaryOnPath').mockResolvedValue(true);
    vi.spyOn(internals.launcher, 'inspectLaunch').mockResolvedValue({
      status: 'ready',
      configOptions: [],
      authMethods: [],
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    });

    try {
      await registry.install(agent.id, { prewarmNpx: false });

      const stored = db.select().from(providers).where(eq(providers.id, agent.id)).get();
      expect(stored?.customEnv).toBe(JSON.stringify({ API_KEY: secretRef }));
      expect(stored?.installedVersion).toBe('2.0.0');
    } finally {
      await getDefaultCredentialVault().deleteProviderSecrets(agent.id);
    }
  });

  test('not_required providers do not spawn a probe for every session', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);
    const agent: RegistryAgent = {
      id: 'no-auth-agent',
      name: 'No Auth',
      version: '1.0.0',
      description: '',
      authors: [],
      distribution: { npx: { package: 'no-auth-agent', args: [], env: {} } },
    };
    await db.insert(registrySnapshots).values({
      data: JSON.stringify({ version: '1', agents: [agent] }),
      fetchedAt: new Date(),
    });
    await db.insert(providers).values({
      id: agent.id,
      name: agent.name,
      command: 'npx',
      installState: 'system_available',
      installSource: 'npx',
      installedVersion: agent.version,
      authState: 'not_required',
      connectionState: 'ready',
    });
    const internals = registry as unknown as { launcher: ProviderLauncher };
    const probe = vi.spyOn(internals.launcher, 'probe');

    await registry.ensureProviderReady(agent.id);

    expect(probe).not.toHaveBeenCalled();
  });

  test('startup recovery clears interrupted install and auth states', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);
    await db.insert(providers).values({
      id: 'interrupted-agent',
      name: 'Interrupted',
      command: 'npx',
      installState: 'installing',
      installStage: 'connecting',
      installSource: 'npx',
      installedVersion: '1.0.0',
      authState: 'authenticating',
      connectionState: 'checking',
    });

    await registry.recoverInterruptedOperations();

    const stored = db.select().from(providers).where(eq(providers.id, 'interrupted-agent')).get();
    expect(stored).toMatchObject({
      installState: 'system_available',
      installStage: null,
      authState: 'required',
      connectionState: 'unknown',
    });
    expect(stored?.installError).toContain('INSTALL_INTERRUPTED');
    expect(stored?.authError).toContain('AUTH_INTERRUPTED');
  });

  test('remove resets provider to not_installed and disables it', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);
    const reg = registry as unknown as { launcher: ProviderLauncher };
    const launcherSpy = vi.spyOn(reg.launcher, 'isBinaryOnPath').mockResolvedValue(true);
    const probeSpy = vi.spyOn(reg.launcher, 'inspectLaunch').mockResolvedValue({
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
    await registry.install('npx-agent', { prewarmNpx: false });

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
    const probeSpy = vi.spyOn(reg.launcher, 'inspectLaunch').mockResolvedValue({
      status: 'ready',
      configOptions: [],
      authMethods: [],
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    });

    const [a, b] = await Promise.all([
      registry.install('dup-agent', { prewarmNpx: false }),
      registry.install('dup-agent', { prewarmNpx: false }),
    ]);
    expect(launcherSpy).toHaveBeenCalledTimes(1);
    expect(a.id).toBe('dup-agent');
    expect(b.id).toBe('dup-agent');
    spy.mockRestore();
    launcherSpy.mockRestore();
    probeSpy.mockRestore();
  }, 15000);

  test('cancelled install returns to not_installed instead of recording a failure', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);
    const agent: RegistryAgent = {
      id: 'cancel-agent',
      name: 'Cancel Agent',
      version: '1.0.0',
      description: '',
      authors: [],
      distribution: {
        binary: {
          'linux-x86_64': {
            archive: 'https://example.com/cancel-agent.tar.gz',
            cmd: 'cancel-agent',
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
    const internals = registry as unknown as {
      launcher: ProviderLauncher;
      installer: BinaryInstaller;
    };
    vi.spyOn(internals.launcher, 'detectSystemBinary').mockResolvedValue(null);
    const installerSpy = vi
      .spyOn(internals.installer, 'install')
      .mockImplementation((_agent, _platform, _logger, options) => {
        options?.onStage?.('downloading');
        options?.onProgress?.({ downloadedBytes: 25, totalBytes: 100 });
        return new Promise((_, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('Install cancelled')), {
            once: true,
          });
        });
      });

    const install = registry.install(agent.id);
    await vi.waitFor(() => {
      expect(installerSpy).toHaveBeenCalledOnce();
    });
    expect(
      (await registry.catalog()).find((provider) => provider.id === agent.id)?.installProgress,
    ).toEqual({ downloadedBytes: 25, totalBytes: 100 });
    registry.cancelInstall(agent.id);

    await expect(install).resolves.toMatchObject({ installState: 'not_installed' });
    expect(registry.getProvider(agent.id)?.installError).toBeNull();
    expect(
      (await registry.catalog()).find((provider) => provider.id === agent.id)?.installProgress,
    ).toBeNull();
    platformSpy.mockRestore();
    archSpy.mockRestore();
  });

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
    const probeSpy = vi.spyOn(reg.launcher, 'inspectLaunch').mockResolvedValue({
      status: 'ready',
      configOptions: [],
      authMethods: [],
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    });
    try {
      const res = await registry.install('fb-agent', { prewarmNpx: false });
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
    const probeSpy = vi.spyOn(reg.launcher, 'inspectLaunch').mockResolvedValue({
      status: 'ready',
      configOptions: [],
      authMethods: [],
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    });
    try {
      const originalInstall = registry.install.bind(registry);
      const spy = vi
        .spyOn(registry, 'install')
        .mockImplementation((id) => originalInstall(id, { prewarmNpx: false }));
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
    const probeSpy = vi.spyOn(reg.launcher, 'inspectLaunch').mockResolvedValue({
      status: 'ready',
      configOptions: [],
      authMethods: [],
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    });
    try {
      const res = await registry.install('range-agent', { prewarmNpx: false });
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

    await registry.sync();
    const stored = db.select().from(providers).where(eq(providers.id, 'codex-acp')).get();
    expect(stored?.customEnv).not.toContain('sk-test');
    expect(stored?.launchEnv).not.toContain('sk-test');
  });

  test('install keeps the artifact installed and records connection failure when probe fails', async () => {
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
      .spyOn(reg.launcher, 'inspectLaunch')
      .mockRejectedValue(new Error('Process exited with code 127'));

    await expect(
      registry.install('probe-fail-agent', { prewarmNpx: false }),
    ).resolves.toMatchObject({
      installState: 'system_available',
      connectionState: 'error',
      authState: 'unknown',
      authError: { code: 'ACP_HANDSHAKE_FAILED' },
    });

    const row = db.select().from(providers).where(eq(providers.id, 'probe-fail-agent')).all()[0];
    expect(row).toBeDefined();
    expect(row.installState).toBe('system_available');
    expect(row.installError).toBeNull();

    launcherSpy.mockRestore();
    probeSpy.mockRestore();
  });

  test('failed update handshake rolls back to the previous working launch', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);
    const agent: RegistryAgent = {
      id: 'rollback-agent',
      name: 'Rollback Agent',
      version: '2.0.0',
      description: '',
      authors: [],
      distribution: { npx: { package: 'rollback-agent', args: [], env: {} } },
    };
    await db.insert(registrySnapshots).values({
      data: JSON.stringify({ version: '1', agents: [agent] }),
      fetchedAt: new Date(),
    });
    await db.insert(providers).values({
      id: agent.id,
      name: agent.name,
      command: 'npx',
      launchArgs: JSON.stringify(['-y', 'rollback-agent@1.0.0']),
      installState: 'system_available',
      installSource: 'npx',
      installedVersion: '1.0.0',
      version: agent.version,
      authState: 'authenticated',
      connectionState: 'ready',
    });
    const internals = registry as unknown as { launcher: ProviderLauncher };
    vi.spyOn(internals.launcher, 'isBinaryOnPath').mockResolvedValue(true);
    vi.spyOn(internals.launcher, 'inspectLaunch').mockImplementation(async () => {
      const duringVerification = db
        .select()
        .from(providers)
        .where(eq(providers.id, agent.id))
        .get();
      expect(JSON.parse(duringVerification?.launchArgs ?? '[]')).toEqual([
        '-y',
        'rollback-agent@1.0.0',
      ]);
      throw new Error('bad handshake');
    });

    const result = await registry.install(agent.id, { prewarmNpx: false });

    expect(result).toMatchObject({
      installedVersion: '1.0.0',
      availableVersion: '2.0.0',
      updateAvailable: true,
      connectionState: 'ready',
    });
    expect(result.launchArgs).toEqual(['-y', 'rollback-agent@1.0.0']);
    expect(result.installError).toContain('ACP_HANDSHAKE_FAILED');
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
    const probeSpy = vi.spyOn(reg.launcher, 'inspectLaunch').mockResolvedValue({
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
