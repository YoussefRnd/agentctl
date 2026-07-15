import { test, describe, expect, beforeEach, vi } from 'vitest';
import { createDatabase } from '../../db/index.js';
import { ProviderStore } from './provider-store.js';
import { BinaryInstaller } from './binary-installer.js';
import { ProviderLauncher } from './provider-launcher.js';
import { AuthProvider } from './auth-provider.js';
import { providers } from '../../db/schema.js';
import type { RegistryAgent } from '@agentctl/shared';

describe('ProviderLauncher & AuthProvider Integration Tests', () => {
  let db: any;
  let store: ProviderStore;
  let launcher: ProviderLauncher;
  let authProvider: AuthProvider;

  beforeEach(() => {
    db = createDatabase(':memory:');
    store = new ProviderStore(db);
    launcher = new ProviderLauncher(store, new BinaryInstaller());
    authProvider = new AuthProvider(launcher, store);
  });

  describe('ProviderLauncher.isBinaryOnPath', () => {
    test('isBinaryOnPath uses clean execFile check to avoid injection', async () => {
      const ok = await launcher.isBinaryOnPath('node');
      expect(ok).toBe(true);
      
      const spaceInjection = await launcher.isBinaryOnPath('node; echo injected');
      expect(spaceInjection).toBe(false);
    });
  });

  describe('ProviderLauncher.resolveLaunch', () => {
    test('resolves simple launch configurations', () => {
      const provider = {
        command: 'my-agent',
        launchArgs: JSON.stringify(['--foo', 'bar']),
        launchEnv: JSON.stringify({ MY_VAR: '123' }),
        customEnv: JSON.stringify({ CUSTOM_VAR: 'abc', MY_VAR: 'override' }),
        installState: 'installed_local'
      };

      const resolved = launcher.resolveLaunch(provider);
      expect(resolved).toEqual({
        command: 'my-agent',
        args: ['--foo', 'bar'],
        env: {
          MY_VAR: 'override',
          CUSTOM_VAR: 'abc'
        }
      });
    });

    test('resolves system_available provider with npx', () => {
      const provider = {
        command: 'my-agent',
        launchArgs: '[]',
        launchEnv: '{}',
        customEnv: '{}',
        installState: 'system_available'
      };

      const agent: RegistryAgent = {
        id: 'my-agent',
        name: 'My Agent',
        version: '1.0.0',
        description: 'test',
        authors: [],
        distribution: {
          npx: {
            package: 'my-agent-package',
            args: ['--npx-flag'],
            env: { NPX_ENV: 'npx-val' }
          }
        }
      };

      const resolved = launcher.resolveLaunch(provider, agent);
      expect(resolved).toEqual({
        command: 'npx',
        args: ['-y', 'my-agent-package', '--npx-flag'],
        env: {
          NPX_ENV: 'npx-val'
        }
      });
    });

    test('resolves system_available provider with uvx', () => {
      const provider = {
        command: 'my-agent',
        launchArgs: '[]',
        launchEnv: '{}',
        customEnv: '{}',
        installState: 'system_available'
      };

      const agent: RegistryAgent = {
        id: 'my-agent',
        name: 'My Agent',
        version: '1.0.0',
        description: 'test',
        authors: [],
        distribution: {
          uvx: {
            package: 'my-agent-package',
            args: ['--uvx-flag'],
            env: { UVX_ENV: 'uvx-val' }
          }
        }
      };

      const resolved = launcher.resolveLaunch(provider, agent);
      expect(resolved).toEqual({
        command: 'uvx',
        args: ['my-agent-package', '--uvx-flag'],
        env: {
          UVX_ENV: 'uvx-val'
        }
      });
    });

    test('throws if system_available provider does not have registry agent metadata', () => {
      const provider = {
        command: 'my-agent',
        installState: 'system_available'
      };

      expect(() => launcher.resolveLaunch(provider)).toThrow(
        'Registry agent metadata required for system_available providers'
      );
    });
  });

  describe('ProviderLauncher.probe', () => {
    const agent: RegistryAgent = {
      id: 'test-prov',
      name: 'Test',
      version: '1.0.0',
      description: 'test',
      authors: [],
      distribution: {}
    };

    beforeEach(() => {
      store.upsert('test-prov', {
        command: 'test-cmd',
        installState: 'installed_local'
      });
    });

    test('calls runtime.probe, caches the promise, and sets authState to authenticated on ready', async () => {
      let callCount = 0;
      const mockRuntime = {
        probe: vi.fn().mockImplementation(async () => {
          callCount++;
          return { status: 'ready' };
        })
      };

      const p1 = launcher.probe('test-prov', mockRuntime, agent);
      const p2 = launcher.probe('test-prov', mockRuntime, agent);

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toEqual({ status: 'ready' });
      expect(r2).toEqual({ status: 'ready' });
      expect(callCount).toBe(1);

      const dbProvider = store.get('test-prov');
      expect(dbProvider?.authState).toBe('authenticated');
    });

    test('sets authState to status returned if not ready', async () => {
      const mockRuntime = {
        probe: vi.fn().mockResolvedValue({ status: 'needs_auth' })
      };

      await launcher.probe('test-prov', mockRuntime, agent);
      const dbProvider = store.get('test-prov');
      expect(dbProvider?.authState).toBe('needs_auth');
    });

    test('sets authState to error on failure and throws', async () => {
      const mockRuntime = {
        probe: vi.fn().mockRejectedValue(new Error('probe failed'))
      };

      await expect(launcher.probe('test-prov', mockRuntime, agent)).rejects.toThrow('probe failed');
      const dbProvider = store.get('test-prov');
      expect(dbProvider?.authState).toBe('error');
    });

    test('invalidateProbe clears the cache', async () => {
      let callCount = 0;
      const mockRuntime = {
        probe: vi.fn().mockImplementation(async () => {
          callCount++;
          return { status: 'ready' };
        })
      };

      await launcher.probe('test-prov', mockRuntime, agent);
      launcher.invalidateProbe('test-prov');
      await launcher.probe('test-prov', mockRuntime, agent);

      expect(callCount).toBe(2);
    });
  });

  describe('AuthProvider', () => {
    const agent = { id: 'test-prov' };
    let child: any;
    let mockConnection: any;
    let createConnectionSpy: any;

    beforeEach(() => {
      store.upsert('test-prov', {
        command: 'test-cmd',
        installState: 'installed_local',
        authState: 'needs_auth'
      });

      child = {
        kill: vi.fn()
      };

      mockConnection = {
        initialize: vi.fn().mockResolvedValue({}),
        authenticate: vi.fn().mockResolvedValue({}),
        logout: vi.fn().mockResolvedValue({}),
        sendRequest: vi.fn().mockResolvedValue({})
      };

      createConnectionSpy = vi.fn().mockReturnValue({ child, connection: mockConnection });
    });

    describe('login', () => {
      test('successfully authenticates, enables provider, invalidates cache and kills child', async () => {
        const invalidateSpy = vi.spyOn(launcher, 'invalidateProbe');

        await authProvider.login(
          'test-prov',
          agent,
          'method-1',
          { user: 'test' },
          createConnectionSpy
        );

        expect(createConnectionSpy).toHaveBeenCalledWith('test-cmd', [], {});
        expect(mockConnection.initialize).toHaveBeenCalledWith({
          protocolVersion: 1,
          clientInfo: { name: 'agentctl-login', title: 'Agentctl', version: '1.0.0' }
        });
        expect(mockConnection.authenticate).toHaveBeenCalledWith({
          methodId: 'method-1',
          _meta: { user: 'test' }
        });

        const dbProv = store.get('test-prov');
        expect(dbProv?.authState).toBe('authenticated');
        expect(dbProv?.installState).toBe('installed_local');
        expect(invalidateSpy).toHaveBeenCalledWith('test-prov');
        expect(child.kill).toHaveBeenCalled();
      });

      test('kills child even if initialization fails', async () => {
        mockConnection.initialize.mockRejectedValue(new Error('init failed'));

        await expect(
          authProvider.login('test-prov', agent, 'method-1', {}, createConnectionSpy)
        ).rejects.toThrow('init failed');

        expect(child.kill).toHaveBeenCalled();
        const dbProv = store.get('test-prov');
        expect(dbProv?.authState).toBe('needs_auth'); // unchanged
      });
    });

    describe('logout', () => {
      test('successfully logs out, sets authState to needs_auth, invalidates cache and kills child', async () => {
        const invalidateSpy = vi.spyOn(launcher, 'invalidateProbe');

        await authProvider.logout('test-prov', agent, createConnectionSpy);

        expect(mockConnection.initialize).toHaveBeenCalled();
        expect(mockConnection.logout).toHaveBeenCalledWith({});
        
        const dbProv = store.get('test-prov');
        expect(dbProv?.authState).toBe('needs_auth');
        expect(invalidateSpy).toHaveBeenCalledWith('test-prov');
        expect(child.kill).toHaveBeenCalled();
      });

      test('falls back to sendRequest("logout") if connection.logout is not a function', async () => {
        delete mockConnection.logout;

        await authProvider.logout('test-prov', agent, createConnectionSpy);

        expect(mockConnection.initialize).toHaveBeenCalled();
        expect(mockConnection.sendRequest).toHaveBeenCalledWith('logout', {});
        
        const dbProv = store.get('test-prov');
        expect(dbProv?.authState).toBe('needs_auth');
        expect(child.kill).toHaveBeenCalled();
      });
    });
  });
});
