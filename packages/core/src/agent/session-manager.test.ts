import { test, expect, describe } from 'vitest';
import { SessionManager, type IEventBus } from './session-manager.js';
import type { DbClient } from './acp-session.js';
import type { WorkspaceManager } from '../git/worktree-manager.js';
import type { ProviderRegistry } from './acp-provider-registry.js';
import { Provider } from './provider.js';
import { noopLogger } from '../logger.js';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { AgentRuntime, AgentRuntimeHandle } from './acp-transport.js';

describe('SessionManager tests', () => {
  const mockDb = {
    update: () => ({
      set: () => ({
        where: () => {
          const p = Promise.resolve([{ id: 1, selectedProvider: 'provider-1' }]);
          return Object.assign(p, {
            returning: () => Promise.resolve([{ id: 1, selectedProvider: 'provider-1' }]),
          });
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: 1, createdAt: new Date() }]),
      }),
    }),
    query: {
      projects: {
        findFirst: () =>
          Promise.resolve({
            id: 'proj-1',
            path: '/tmp',
            repoRoot: '/tmp',
            subdir: '',
          }),
      },
      sessions: {
        findFirst: () =>
          Promise.resolve({
            id: 'sess-1',
            projectId: 'proj-1',
            selectedProvider: 'provider-1',
            selectedModel: 'model-1',
            selectedThinkingEffort: 'medium',
            mode: 'local' as const,
            project: {
              id: 'proj-1',
              path: '/tmp',
              repoRoot: '/tmp',
            },
          }),
      },
    },
  } as unknown as DbClient;

  const mockWorkspaceManager = {
    create: () =>
      Promise.resolve({
        path: '/tmp/worktree',
        workspacePath: '/tmp/worktree',
        branch: 'agentctl/test-branch',
        baseCommit: 'abc',
      }),
  } as unknown as WorkspaceManager;

  const mockProviderRegistry = {
    ensureProviderReady: () =>
      Promise.resolve(
        new Provider({
          id: 'provider-1',
          name: 'Provider 1',
          status: 'ready',
          command: 'sleep',
          enabled: true,
          launchArgs: '["10"]',
          launchEnv: '{}',
          customEnv: '{}',
          configOptions: '[]',
          authMethods: '[]',
          supportsDynamicModel: false,
          supportsDynamicConfig: false,
          version: '1.0.0',
          description: 'test',
          icon: '',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
  } as unknown as ProviderRegistry;

  const eventBus = {
    publish: () => undefined,
  } as unknown as IEventBus;

  const fakeRuntime: AgentRuntime = {
    execute() {
      const fakeChild = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: () => true,
      }) as unknown as NonNullable<AgentRuntimeHandle['child']>;

      return Promise.resolve({
        acpSessionId: 'session-id-123',
        connection: {} as unknown as AgentRuntimeHandle['connection'],
        child: fakeChild,
        closed: new Promise<void>(() => undefined),
        prompt: () => Promise.resolve(),
        respondToPermission: () => undefined,
        stop: () => Promise.resolve(),
      });
    },
    probe() {
      return Promise.resolve({
        status: 'ready',
        configOptions: [],
        authMethods: [],
        supportsDynamicModel: false,
        supportsDynamicConfig: false,
      });
    },
  };

  test('SessionManager startSession creates and initializes a session', async () => {
    const manager = new SessionManager(mockDb, mockWorkspaceManager, mockProviderRegistry, eventBus, noopLogger, fakeRuntime);
    const session = await manager.startSession('session-1', '/tmp', 'sleep', ['10'], {});

    expect(session).toBeDefined();
    expect(session.sessionId).toBe('session-1');

    session.kill();
  });

  test('SessionManager createSession orchestrates dependencies and starts session', async () => {
    const manager = new SessionManager(mockDb, mockWorkspaceManager, mockProviderRegistry, eventBus, noopLogger, fakeRuntime);
    const session = await manager.createSession({
      projectId: 'proj-1',
      providerId: 'provider-1',
      taskSlug: 'test-task',
      mode: 'local',
    });

    expect(session).toBeDefined();
    expect(session.sessionId).toBeDefined();
    session.kill();
  });

  test('SessionManager resuscitates a dead session or a session not in memory on client message input', async () => {
    const manager = new SessionManager(mockDb, mockWorkspaceManager, mockProviderRegistry, eventBus, noopLogger, fakeRuntime);
    
    // 1. Session is not in memory. Send message, it should resuscitate (load from DB and startSession)
    expect(manager.getSession('sess-1')).toBeUndefined();

    let restarted = false;
    // Let's spy on restartSession
    const originalRestart = manager.restartSession.bind(manager);
    manager.restartSession = async (id: string) => {
      restarted = true;
      return originalRestart(id);
    };

    await manager.handleClientMessage('sess-1', 'session.input', { input: 'hello' });

    expect(restarted).toBe(true);
    const session = manager.getSession('sess-1');
    expect(session).toBeDefined();
    expect(session?.isDead).toBe(false);

    // 2. Kill the session (making it dead). Sending message again should trigger resuscitation.
    session?.kill();
    expect(session?.isDead).toBe(true);

    restarted = false;
    await manager.handleClientMessage('sess-1', 'session.input', { input: 'hello again' });

    expect(restarted).toBe(true);
    const newSession = manager.getSession('sess-1');
    expect(newSession).toBeDefined();
    expect(newSession?.isDead).toBe(false);

    newSession?.kill();
  });

  test('SessionManager updateSessionConfig updates dynamically when supported, otherwise restarts', async () => {
    // Mock provider with dynamic features enabled
    const dynamicProvider = new Provider({
      id: 'provider-dynamic',
      name: 'Dynamic Provider',
      status: 'ready',
      command: 'sleep',
      enabled: true,
      launchArgs: '["10"]',
      launchEnv: '{}',
      customEnv: '{}',
      configOptions: '[]',
      authMethods: '[]',
      supportsDynamicModel: true,
      supportsDynamicConfig: true,
      version: '1.0.0',
      description: 'test',
      icon: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const registry = {
      ensureProviderReady: (id: string) => {
        if (id === 'provider-dynamic') {
          return Promise.resolve(dynamicProvider);
        }
        return mockProviderRegistry.ensureProviderReady(id, { force: false });
      },
    } as unknown as ProviderRegistry;

    const sessionRecordVal = {
      id: 'sess-1',
      projectId: 'proj-1',
      selectedProvider: 'provider-dynamic',
      selectedModel: 'model-1',
      selectedThinkingEffort: 'medium',
      mode: 'local' as const,
      project: {
        id: 'proj-1',
        path: '/tmp',
        repoRoot: '/tmp',
      },
    };

    const localDb = {
      insert: (table: Parameters<typeof mockDb.insert>[0]) => mockDb.insert(table),
      update: () => ({
        set: (fields: Record<string, unknown>) => {
          Object.assign(sessionRecordVal, fields);
          return {
            where: () => {
              const p = Promise.resolve([sessionRecordVal]);
              return Object.assign(p, {
                returning: () => Promise.resolve([sessionRecordVal]),
              });
            },
          };
        },
      }),
      query: {
        projects: mockDb.query.projects,
        sessions: {
          findFirst: () => Promise.resolve({ ...sessionRecordVal }),
        },
      },
    } as unknown as DbClient;

    const manager = new SessionManager(localDb, mockWorkspaceManager, registry, eventBus, noopLogger, fakeRuntime);

    // Initial start to populate the manager's active sessions map
    const session = await manager.startSession('sess-1', '/tmp', 'sleep', ['10'], {}, 'model-1', 'medium', true, true);
    
    let modelUpdated = '';
    let configUpdated: [string, string] | null = null;

    session.updateModel = (modelId: string) => {
      modelUpdated = modelId;
      return Promise.resolve();
    };
    session.updateConfigOption = (configId: string, value: string) => {
      configUpdated = [configId, value];
      return Promise.resolve();
    };

    let restarted = false;
    manager.restartSession = (_id: string) => {
      restarted = true;
      return Promise.resolve(session);
    };

    // 1. Dynamic update for same provider, model change
    await manager.updateSessionConfig('sess-1', {
      selectedProvider: 'provider-dynamic',
      selectedModel: 'model-2',
      selectedThinkingEffort: 'medium',
    });

    expect(modelUpdated).toBe('model-2');
    expect(configUpdated).toBeNull();
    expect(restarted).toBe(false);

    // 2. Dynamic update for same provider, config/effort change
    modelUpdated = '';
    await manager.updateSessionConfig('sess-1', {
      selectedProvider: 'provider-dynamic',
      selectedModel: 'model-2',
      selectedThinkingEffort: 'high',
    });

    expect(modelUpdated).toBe('');
    expect(configUpdated).toEqual(['thinking_effort', 'high']);
    expect(restarted).toBe(false);

    // 3. Provider changed -> restarts the session
    configUpdated = null;
    await manager.updateSessionConfig('sess-1', {
      selectedProvider: 'provider-1',
      selectedModel: 'model-2',
      selectedThinkingEffort: 'high',
    });

    expect(restarted).toBe(true);

    session.kill();
  });
});
