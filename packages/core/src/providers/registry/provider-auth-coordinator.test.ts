import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProviderAuthCoordinator } from './provider-auth-coordinator.js';
import { ProviderStore } from './provider-store.js';
import { ProviderLauncher } from './provider-launcher.js';
import { BinaryInstaller } from './binary-installer.js';
import { RegistryFetcher } from './registry-fetcher.js';
import type { AgentConnectionManager } from '../../acp/types.js';
import type { AgentDriver } from '../../agent/types.js';
import { createDatabase } from '../../db/index.js';
import { EMPTY_AGENT_FEATURES } from '@agentctl/shared';
import type { CoreDatabase } from '../../db/index.js';

describe('ProviderAuthCoordinator', () => {
  let tmpDir: string;
  let db: CoreDatabase;
  let store: ProviderStore;
  let launcher: ProviderLauncher;
  let runtime: AgentDriver;
  let fetcher: RegistryFetcher;
  let connectionManager: AgentConnectionManager;
  let coordinator: ProviderAuthCoordinator;
  let stateChanges = 0;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-coord-test-'));
    const dbPath = path.join(tmpDir, 'test.db');
    db = createDatabase(dbPath);
    store = new ProviderStore(db);
    launcher = new ProviderLauncher(store, new BinaryInstaller());
    stateChanges = 0;

    // Seed test provider in store
    store.upsert('test-agent', {
      id: 'test-agent',
      name: 'Test Agent',
      command: 'test-agent',
      launchArgs: '[]',
      launchEnv: '{}',
      customEnv: '{}',
      distribution: '{}',
      installState: 'installed_local',
      authState: 'required',
      connectionState: 'unknown',
      authError: null,
      lastVerifiedAt: null,
      enabled: true,
      hidden: false,
      configOptions: '[]',
      authMethods: JSON.stringify([
        { id: 'web_oauth', name: 'Web OAuth', type: 'agent' },
        { id: 'term_login', name: 'Terminal Login', type: 'terminal', args: ['login'] },
      ]),
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
      supportsLogout: true,
      nativelyLoadsSkills: false,
      modes: '[]',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const mockDescriptor = {
      status: 'ready' as const,
      configOptions: [],
      authMethods: [
        { id: 'web_oauth', name: 'Web OAuth', type: 'agent' as const },
        { id: 'term_login', name: 'Terminal Login', type: 'terminal' as const, args: ['login'] },
      ],
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
      supportsLogout: true,
      features: {
        ...EMPTY_AGENT_FEATURES,
        authentication: { logout: true },
      },
    };

    runtime = {
      inspectProvider: vi.fn().mockResolvedValue(mockDescriptor),
      probe: vi.fn().mockResolvedValue(mockDescriptor),
      authenticateProvider: vi.fn().mockResolvedValue(undefined),
      logoutProvider: vi.fn().mockResolvedValue(undefined),
    } as unknown as AgentDriver;

    fetcher = {
      getSnapshot: vi.fn().mockReturnValue(null),
    } as unknown as RegistryFetcher;

    connectionManager = {
      closeConnection: vi.fn(),
    } as unknown as AgentConnectionManager;

    coordinator = new ProviderAuthCoordinator({
      store,
      launcher,
      runtime,
      fetcher,
      connectionManager,
      onStateChange: () => {
        stateChanges++;
      },
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects unadvertised auth method', async () => {
    await expect(coordinator.login('test-agent', 'non_existent_method')).rejects.toThrow(
      /not advertised/i,
    );
  });

  it('forbids passing terminal auth method directly to authenticateProvider', async () => {
    await expect(coordinator.login('test-agent', 'term_login')).rejects.toThrow(
      /terminal authentication must run in an interactive terminal/i,
    );
    expect(runtime.authenticateProvider).not.toHaveBeenCalled();
  });

  it('successfully authenticates agent method, invalidates connection, and verifies probe', async () => {
    await coordinator.login('test-agent', 'web_oauth');

    expect(runtime.authenticateProvider).toHaveBeenCalledWith(
      'test-agent',
      [],
      {},
      'web_oauth',
      expect.objectContaining({ timeoutMs: 120_000, signal: expect.any(AbortSignal) }),
    );
    expect(connectionManager.closeConnection).toHaveBeenCalledWith('test-agent');
    expect(runtime.inspectProvider).toHaveBeenCalled();

    const updated = store.get('test-agent')!;
    expect(updated.authState).toBe('authenticated');
    expect(updated.connectionState).toBe('ready');
    expect(updated.authError).toBeNull();
    expect(updated.lastVerifiedAt).not.toBeNull();
    expect(stateChanges).toBeGreaterThan(0);
  });

  it('runs terminal methods as commands and verifies before succeeding', async () => {
    const executeCommand = vi.fn().mockResolvedValue({ exitCode: 0 });

    await coordinator.runTerminalAuth('test-agent', 'term_login', executeCommand);

    expect(executeCommand).toHaveBeenCalledWith(
      'test-agent',
      ['login'],
      {},
      expect.any(AbortSignal),
    );
    expect(runtime.authenticateProvider).not.toHaveBeenCalled();
    expect(store.get('test-agent')?.authState).toBe('authenticated');
    expect(store.get('test-agent')?.connectionState).toBe('ready');
  });

  it('aborts a terminal auth process when its timeout expires', async () => {
    let commandSignal: AbortSignal | undefined;
    const executeCommand = vi.fn(
      (_command: string, _args: string[], _env: Record<string, string>, signal: AbortSignal) => {
        commandSignal = signal;
        return new Promise<{ exitCode: number }>(() => undefined);
      },
    );

    await expect(
      coordinator.runTerminalAuth('test-agent', 'term_login', executeCommand, { timeoutMs: 5 }),
    ).rejects.toThrow(/timed out/i);

    expect(commandSignal?.aborted).toBe(true);
    expect(store.get('test-agent')?.authError).toContain('AUTH_TIMEOUT');
  });

  it('marks a successfully probed provider with no auth methods as not required', async () => {
    vi.mocked(runtime.inspectProvider).mockResolvedValueOnce({
      status: 'ready',
      configOptions: [],
      authMethods: [],
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
      supportsLogout: false,
      features: EMPTY_AGENT_FEATURES,
    });

    await coordinator.verify('test-agent');

    expect(store.get('test-agent')?.authState).toBe('not_required');
    expect(store.get('test-agent')?.connectionState).toBe('ready');
  });

  it('preserves known authentication when a manual verification has a transport failure', async () => {
    store.setAuthDetails('test-agent', {
      authState: 'authenticated',
      connectionState: 'ready',
    });
    vi.mocked(runtime.inspectProvider).mockRejectedValueOnce(new Error('connection refused'));

    await expect(coordinator.verify('test-agent')).rejects.toThrow('connection refused');

    expect(store.get('test-agent')).toMatchObject({
      authState: 'authenticated',
      connectionState: 'error',
    });
    expect(store.get('test-agent')?.authError).toContain('VERIFICATION_ERROR');
  });

  it('returns to required if post-auth verification rejects credentials', async () => {
    vi.mocked(runtime.inspectProvider).mockResolvedValueOnce({
      status: 'needs_auth',
      configOptions: [],
      authMethods: [{ id: 'web_oauth', name: 'Web OAuth', type: 'agent' }],
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
      supportsLogout: true,
      features: {
        ...EMPTY_AGENT_FEATURES,
        authentication: { logout: true },
      },
    });

    await expect(coordinator.login('test-agent', 'web_oauth')).rejects.toThrow(
      /credentials rejected by agent/i,
    );

    const updated = store.get('test-agent')!;
    expect(updated.authState).toBe('required');
    expect(updated.connectionState).toBe('ready');
    expect(updated.authError).toContain('AUTH_REQUIRED');
  });

  it('cancels active login operation and resets state', async () => {
    let resolveAuth: () => void;
    vi.mocked(runtime.authenticateProvider!).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAuth = resolve;
        }),
    );

    const loginPromise = coordinator.login('test-agent', 'web_oauth');
    // Allow microtask queue to process so state transitions to authenticating
    await new Promise((r) => setTimeout(r, 10));

    expect(store.get('test-agent')!.authState).toBe('authenticating');

    // Cancel while authenticating
    coordinator.cancelLogin('test-agent');

    const updated = store.get('test-agent')!;
    expect(updated.authState).toBe('required');
    expect(connectionManager.closeConnection).toHaveBeenCalledWith('test-agent');

    resolveAuth!();
    await expect(loginPromise).rejects.toThrow(/cancelled/i);
  });

  it('preserves error in store when logout fails instead of blindly clearing state', async () => {
    vi.mocked(runtime.logoutProvider!).mockRejectedValueOnce(
      new Error('Remote session expired or unreachable'),
    );

    await expect(coordinator.logout('test-agent')).rejects.toThrow(
      'Remote session expired or unreachable',
    );

    const updated = store.get('test-agent')!;
    expect(updated.authError).toContain('LOGOUT_FAILED');
    expect(updated.authError).toContain('Remote session expired or unreachable');
  });

  it('successfully logs out provider, deletes secrets, and marks required', async () => {
    await coordinator.logout('test-agent');

    expect(runtime.logoutProvider).toHaveBeenCalled();
    const updated = store.get('test-agent')!;
    expect(updated.authState).toBe('required');
    expect(updated.connectionState).toBe('unknown');
    expect(updated.lastVerifiedAt).toBeNull();
    expect(updated.authError).toBeNull();
  });
});
