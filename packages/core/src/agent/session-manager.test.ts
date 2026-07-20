import { test, expect, describe, vi } from 'vitest';
import { SessionManager, type IEventBus } from './session-manager.js';
import type { DbClient, ACPSession } from './acp-session.js';
import type { WorkspaceManager } from '../git/worktree-manager.js';
import type { ProviderRegistry } from './acp-provider-registry.js';
import { Provider } from './provider.js';
import { noopLogger } from '../logger.js';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { AgentRuntime } from './acp-transport.js';
import type { ChildProcess } from 'node:child_process';

describe('SessionManager tests', () => {
  const mockDb = {
    select: () => ({
      from: () => ({
        where: () => {
          const p = Promise.resolve([]);
          return Object.assign(p, {
            orderBy: () => Promise.resolve([]),
          });
        },
      }),
    }),
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
            id: 'project-1',
            path: '/tmp/project-1',
          }),
      },
      sessions: {
        findFirst: () =>
          Promise.resolve({
            id: 'session-1',
            agent: 'provider-1',
            status: 'idle',
            selectedProvider: 'provider-1',
            selectedModel: 'model-1',
            selectedThinkingEffort: 'medium',
            project: {
              id: 'project-1',
              path: '/tmp/project-1',
            },
          }),
        findMany: () => Promise.resolve([]),
      },
      providers: {
        findFirst: () =>
          Promise.resolve({
            id: 'provider-1',
            nativelyLoadsSkills: false,
          }),
      },
    },
  } as unknown as DbClient;

  const mockWorkspaceManager = {
    create: () =>
      Promise.resolve({
        path: '/tmp/worktree-1',
        workspacePath: '/tmp/worktree-1',
        branch: 'branch-1',
        baseCommit: 'commit-1',
      }),
    cleanup: () => Promise.resolve(),
    removeWorktreeOnly: () => Promise.resolve(),
  } as unknown as WorkspaceManager;

  const mockProviderRegistry = {
    ensureProviderReady: () =>
      Promise.resolve(
        new Provider({
          id: 'provider-1',
          name: 'Provider 1',
          installState: 'installed_local',
          authState: 'authenticated',
          enabled: true,
          hidden: false,
          distribution: '{}',
          command: 'node',
          launchArgs: '[]',
          launchEnv: '{}',
          customEnv: '{}',
          configOptions: '[]',
          authMethods: '[]',
          supportsDynamicModel: false,
          supportsDynamicConfig: false,
          supportsLogout: false,
          nativelyLoadsSkills: false,
          modes: '[]',
          version: '1.0.0',
          description: 'test',
          icon: '',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
    getSettings: () => Promise.resolve({ defaultProviderId: 'provider-1' }),
    discover: () =>
      Promise.resolve([
        new Provider({
          id: 'provider-1',
          name: 'Provider 1',
          installState: 'installed_local',
          authState: 'authenticated',
          enabled: true,
          hidden: false,
          distribution: '{}',
          command: 'node',
          launchArgs: '[]',
          launchEnv: '{}',
          customEnv: '{}',
          configOptions: '[]',
          authMethods: '[]',
          supportsDynamicModel: false,
          supportsDynamicConfig: false,
          supportsLogout: false,
          nativelyLoadsSkills: false,
          modes: '[]',
          version: '1.0.0',
          description: 'test',
          icon: '',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ]),
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
      }) as unknown as ChildProcess;

      return Promise.resolve({
        acpSessionId: 'session-id-123',
        historyRestored: false,
        sessionCreationKind: 'new',
        closed: new Promise<void>(() => undefined),
        onProcessError(handler) {
          fakeChild.on('error', handler);
        },
        onProcessExit(handler) {
          fakeChild.once('exit', handler);
        },
        prompt: (_text: string, _attachments?: unknown[], _embedded?: string) =>
          Promise.resolve({ stopReason: 'end_turn' }),
        authenticate: () => Promise.resolve(),
        cancel: () => Promise.resolve(),
        stop: () => Promise.resolve(),
      });
    },
    probe() {
      return Promise.resolve({
        status: 'ready' as const,
        configOptions: [],
        authMethods: [],
        supportsDynamicModel: false,
        supportsDynamicConfig: false,
        modes: [],
      });
    },
  };

  test('SessionManager startSession creates and initializes a session', async () => {
    const manager = new SessionManager(
      mockDb,
      mockWorkspaceManager,
      mockProviderRegistry,
      eventBus,
      noopLogger,
      fakeRuntime,
    );
    const session = await manager.startSession('session-1', '/tmp', 'sleep', ['10'], {});

    expect(session).toBeDefined();
    expect(session.sessionId).toBe('session-1');

    session.kill();
  });

  test('SessionManager createSession orchestrates dependencies and starts session', async () => {
    const manager = new SessionManager(
      mockDb,
      mockWorkspaceManager,
      mockProviderRegistry,
      eventBus,
      noopLogger,
      fakeRuntime,
    );
    const session = await manager.createSession({
      projectId: 'proj-1',
      providerId: 'provider-1',
      taskSlug: 'test-task',
      mode: 'local',
    });

    expect(session).toBeDefined();
    expect(session.sessionId).toBeDefined();
  });

  test('SessionManager createSession defaults Git projects to worktree mode', async () => {
    let insertedSession: Record<string, unknown> | null = null;
    let createCalled = false;

    const db = {
      select: () => mockDb.select(),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve([{ id: 1, selectedProvider: 'provider-1' }]),
        }),
      }),
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          insertedSession = values;
          return {
            returning: () => Promise.resolve([{ id: values.id, createdAt: new Date() }]),
          };
        },
      }),
      query: {
        projects: {
          findFirst: () =>
            Promise.resolve({
              id: 'git-project',
              path: '/tmp/repo/packages/app',
              repoRoot: '/tmp/repo',
              subdir: 'packages/app',
            }),
        },
        sessions: mockDb.query.sessions,
        providers: mockDb.query.providers,
      },
    } as unknown as DbClient;

    const workspaceManager = {
      resolveBaseRef: (repoPath: string, preferredRef: string) => {
        expect(repoPath).toBe('/tmp/repo');
        expect(preferredRef).toBe('main');
        return Promise.resolve({ ref: 'trunk', commit: 'base-commit', isEmpty: false });
      },
      create: (
        repoPath: string,
        _sessionId: string,
        taskSlug: string,
        baseBranch: string,
        subdir: string,
      ) => {
        expect(repoPath).toBe('/tmp/repo');
        expect(taskSlug).toBe('parallel-task');
        expect(baseBranch).toBe('trunk');
        expect(subdir).toBe('packages/app');
        createCalled = true;
        return Promise.resolve({
          path: '/tmp/worktrees/git-project/session-1',
          workspacePath: '/tmp/worktrees/git-project/session-1/packages/app',
          branch: 'agentctl/session-1/parallel-task',
          baseCommit: 'base-commit',
        });
      },
      cleanup: () => Promise.resolve(),
      removeWorktreeOnly: () => Promise.resolve(),
    } as unknown as WorkspaceManager;

    const manager = new SessionManager(
      db,
      workspaceManager,
      mockProviderRegistry,
      eventBus,
      noopLogger,
      fakeRuntime,
    );
    const session = await manager.createSession({
      projectId: 'git-project',
      providerId: 'provider-1',
      taskSlug: 'parallel-task',
    });

    expect(session.sessionId).toBeDefined();
    expect(createCalled).toBe(true);
    expect(insertedSession).toMatchObject({
      mode: 'worktree',
      worktreePath: '/tmp/worktrees/git-project/session-1/packages/app',
      branch: 'agentctl/session-1/parallel-task',
      baseCommit: 'base-commit',
    });
  });

  test('SessionManager createSession defaults non-Git projects to local mode', async () => {
    let insertedSession: Record<string, unknown> | null = null;
    let createCalled = false;

    const db = {
      select: () => mockDb.select(),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve([{ id: 1, selectedProvider: 'provider-1' }]),
        }),
      }),
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          insertedSession = values;
          return {
            returning: () => Promise.resolve([{ id: values.id, createdAt: new Date() }]),
          };
        },
      }),
      query: {
        projects: {
          findFirst: () =>
            Promise.resolve({
              id: 'plain-project',
              path: '/tmp/plain-project',
              repoRoot: null,
              subdir: '',
            }),
        },
        sessions: mockDb.query.sessions,
        providers: mockDb.query.providers,
      },
    } as unknown as DbClient;

    const workspaceManager = {
      create: () => {
        createCalled = true;
        return Promise.resolve({
          path: '/tmp/should-not-be-used',
          workspacePath: '/tmp/should-not-be-used',
          branch: 'should-not-be-used',
          baseCommit: 'should-not-be-used',
        });
      },
      cleanup: () => Promise.resolve(),
      removeWorktreeOnly: () => Promise.resolve(),
    } as unknown as WorkspaceManager;

    const manager = new SessionManager(
      db,
      workspaceManager,
      mockProviderRegistry,
      eventBus,
      noopLogger,
      fakeRuntime,
    );
    const session = await manager.createSession({
      projectId: 'plain-project',
      providerId: 'provider-1',
      taskSlug: 'local-task',
    });

    expect(session.sessionId).toBeDefined();
    expect(createCalled).toBe(false);
    expect(insertedSession).toMatchObject({
      mode: 'local',
      worktreePath: '/tmp/plain-project',
      branch: 'main',
      baseCommit: 'none',
    });
  });

  test('SessionManager resuscitates a dead session or a session not in memory on client message input', async () => {
    const manager = new SessionManager(
      mockDb,
      mockWorkspaceManager,
      mockProviderRegistry,
      eventBus,
      noopLogger,
      fakeRuntime,
    );

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
      installState: 'installed_local',
      authState: 'authenticated',
      enabled: true,
      hidden: false,
      distribution: '{}',
      command: 'sleep',
      launchArgs: '["10"]',
      launchEnv: '{}',
      customEnv: '{}',
      configOptions:
        '[{"id": "thinking_effort", "name": "Thinking Effort", "description": "", "type": "string", "options": [{"value": "medium"}, {"value": "high"}]}]',
      authMethods: '[]',
      supportsDynamicModel: true,
      supportsDynamicConfig: true,
      supportsLogout: false,
      nativelyLoadsSkills: false,
      modes: '[]',
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
      getSettings: () => mockProviderRegistry.getSettings(),
      discover: () => mockProviderRegistry.discover(),
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
      select: () => mockDb.select(),
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
          findMany: () => Promise.resolve([]),
        },
      },
    } as unknown as DbClient;

    const manager = new SessionManager(
      localDb,
      mockWorkspaceManager,
      registry,
      eventBus,
      noopLogger,
      fakeRuntime,
    );

    // Initial start to populate the manager's active sessions map
    const session = await manager.startSession(
      'sess-1',
      '/tmp',
      'sleep',
      ['10'],
      {},
      'model-1',
      'medium',
      true,
      true,
    );

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

  test('restores an advertised agent persona on startup without sending approvalMode', async () => {
    const setMode = vi.fn(() => Promise.resolve());
    const runtime: AgentRuntime = {
      ...fakeRuntime,
      execute: () =>
        Promise.resolve({
          acpSessionId: 'agent-session',
          availableModes: ['architect', 'coder'],
          historyRestored: false,
          sessionCreationKind: 'new',
          closed: new Promise<void>(() => undefined),
          onProcessError: vi.fn(),
          onProcessExit: vi.fn(),
          prompt: () => Promise.resolve({ stopReason: 'end_turn' }),
          authenticate: () => Promise.resolve(),
          cancel: () => Promise.resolve(),
          stop: () => Promise.resolve(),
          setMode,
        }),
    };
    const db = Object.assign({}, mockDb, {
      query: Object.assign({}, mockDb.query, {
        sessions: Object.assign({}, mockDb.query.sessions, {
          findFirst: () =>
            Promise.resolve({
              id: 'session-1',
              selectedProvider: 'provider-1',
              approvalMode: 'yolo',
              agentPersona: 'architect',
              agentSessionId: null,
            }),
        }),
      }),
    }) as unknown as DbClient;
    const manager = new SessionManager(
      db,
      mockWorkspaceManager,
      mockProviderRegistry,
      eventBus,
      noopLogger,
      runtime,
    );

    const session = await manager.startSession('session-1', '/tmp', 'agent', []);
    expect(setMode).toHaveBeenCalledTimes(1);
    expect(setMode).toHaveBeenCalledWith('architect');
    expect(setMode).not.toHaveBeenCalledWith('yolo');
    session.kill();
  });

  test('validates persona before DB mutation and never sends approval policy through ACP setMode', async () => {
    const update = vi.fn(() => ({
      set: () => ({ where: () => Promise.resolve() }),
    }));
    const db = Object.assign({}, mockDb, {
      update,
      query: Object.assign({}, mockDb.query, {
        sessions: Object.assign({}, mockDb.query.sessions, {
          findFirst: () =>
            Promise.resolve({
              id: 'session-1',
              availableAgentPersonas: JSON.stringify(['coder']),
            }),
        }),
      }),
    }) as unknown as DbClient;
    const manager = new SessionManager(
      db,
      mockWorkspaceManager,
      mockProviderRegistry,
      eventBus,
      noopLogger,
      fakeRuntime,
    );

    await expect(manager.setAgentPersona('session-1', 'architect')).rejects.toThrow(
      'Agent persona is not available',
    );
    expect(update).not.toHaveBeenCalled();

    const setMode = vi.fn();
    Object.defineProperty(manager, 'stateMachine', {
      value: { getSession: () => ({ isDead: false, setMode }) },
    });
    await manager.updateApprovalMode('session-1', 'yolo');
    expect(setMode).not.toHaveBeenCalled();
  });

  test('setConfigOption fails for an inactive session', async () => {
    const manager = new SessionManager(
      mockDb,
      mockWorkspaceManager,
      mockProviderRegistry,
      eventBus,
      noopLogger,
      fakeRuntime,
    );

    await expect(manager.setConfigOption('missing', 'thinking', 'high')).rejects.toThrow(
      'Session is not active: missing',
    );
  });

  test('prompt concurrency errors propagate to the client-message caller', async () => {
    const manager = new SessionManager(
      mockDb,
      mockWorkspaceManager,
      mockProviderRegistry,
      eventBus,
      noopLogger,
      fakeRuntime,
    );
    const session = await manager.startSession('session-1', '/tmp', 'agent', []);
    session.prompt = () => Promise.reject(new Error('prompt already in progress'));

    await expect(
      manager.handleClientMessage('session-1', 'session.input', { input: 'second prompt' }),
    ).rejects.toThrow('prompt already in progress');
    session.kill();
  });

  test('rewind rejects an event belonging to another session', async () => {
    const manager = new SessionManager(
      mockDb,
      mockWorkspaceManager,
      mockProviderRegistry,
      eventBus,
      noopLogger,
      fakeRuntime,
    );
    const getEventWithMetadata = vi.fn(() => Promise.resolve(null));
    Object.defineProperty(manager, 'eventStore', {
      value: { getEventWithMetadata },
    });

    await expect(manager.rewindSession('session-1', 99, 'conversation')).rejects.toThrow(
      'Event not found: 99',
    );
    expect(getEventWithMetadata).toHaveBeenCalledWith('session-1', 99);
  });

  test('SessionManager deleteSession calls runtime deleteAgentSession if agentSessionId is present', async () => {
    let deletedAgentSessionId = '';
    const spyRuntime: AgentRuntime = {
      ...fakeRuntime,
      deleteAgentSession(_cmd, _args, _env, acpSessionId) {
        deletedAgentSessionId = acpSessionId;
        return Promise.resolve();
      },
    };

    const localDb = {
      query: {
        sessions: {
          findFirst: () =>
            Promise.resolve({
              id: 'session-to-delete',
              agent: 'provider-1',
              status: 'idle',
              selectedProvider: 'provider-1',
              selectedModel: 'model-1',
              selectedThinkingEffort: 'medium',
              agentSessionId: 'agent-session-abc',
              project: {
                id: 'project-1',
                path: '/tmp/project-1',
              },
            }),
        },
      },
    } as unknown as DbClient;

    const manager = new SessionManager(
      mockDb,
      mockWorkspaceManager,
      mockProviderRegistry,
      eventBus,
      noopLogger,
      spyRuntime,
    );
    // Replace with local db mock
    Object.defineProperty(manager, 'db', { value: localDb });

    await manager.deleteSession('session-to-delete');
    expect(deletedAgentSessionId).toBe('agent-session-abc');
  });

  test('SessionManager updateSessionConfig allows selecting provider requiring auth', async () => {
    const authProvider = new Provider({
      id: 'provider-auth-required',
      name: 'Auth Required Provider',
      installState: 'installed_local',
      authState: 'needs_auth',
      enabled: true,
      hidden: false,
      distribution: '{}',
      command: 'sleep',
      launchArgs: '["10"]',
      launchEnv: '{}',
      customEnv: '{}',
      configOptions: '[]',
      authMethods: '[]',
      supportsDynamicModel: true,
      supportsDynamicConfig: true,
      supportsLogout: false,
      nativelyLoadsSkills: false,
      modes: '[]',
      version: '1.0.0',
      description: 'test',
      icon: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const registry = {
      ensureProviderReady: (id: string) => {
        if (id === 'provider-auth-required') {
          return Promise.resolve(authProvider);
        }
        return mockProviderRegistry.ensureProviderReady(id, { force: false });
      },
      getSettings: () => mockProviderRegistry.getSettings(),
      discover: () => mockProviderRegistry.discover(),
    } as unknown as ProviderRegistry;

    const sessionRecordVal = {
      id: 'sess-1',
      projectId: 'proj-1',
      selectedProvider: 'provider-auth-required',
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
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      }),
      query: {
        sessions: {
          findFirst: () => Promise.resolve(sessionRecordVal),
        },
      },
    } as unknown as DbClient;

    const manager = new SessionManager(
      localDb,
      mockWorkspaceManager,
      registry,
      eventBus,
      noopLogger,
      fakeRuntime,
    );

    manager.restartSession = vi.fn(() => Promise.resolve({} as unknown as ACPSession));

    // Should NOT throw an error when selecting provider requiring auth
    await expect(
      manager.updateSessionConfig('sess-1', {
        selectedProvider: 'provider-auth-required',
        selectedModel: 'default',
        selectedThinkingEffort: 'medium',
      }),
    ).resolves.not.toThrow();

    expect(manager.restartSession).toHaveBeenCalledWith('sess-1');
  });

  test('SessionManager setConfigOption allows configuring provider requiring auth', async () => {
    const authProvider = new Provider({
      id: 'provider-auth-required',
      name: 'Auth Required Provider',
      installState: 'installed_local',
      authState: 'needs_auth',
      enabled: true,
      hidden: false,
      distribution: '{}',
      command: 'sleep',
      launchArgs: '["10"]',
      launchEnv: '{}',
      customEnv: '{}',
      configOptions: '[]',
      authMethods: '[]',
      supportsDynamicModel: true,
      supportsDynamicConfig: true,
      supportsLogout: false,
      nativelyLoadsSkills: false,
      modes: '[]',
      version: '1.0.0',
      description: 'test',
      icon: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const registry = {
      ensureProviderReady: (id: string) => {
        if (id === 'provider-auth-required') {
          return Promise.resolve(authProvider);
        }
        return mockProviderRegistry.ensureProviderReady(id, { force: false });
      },
      getSettings: () => mockProviderRegistry.getSettings(),
      discover: () => mockProviderRegistry.discover(),
    } as unknown as ProviderRegistry;

    const sessionRecordVal = {
      id: 'sess-1',
      projectId: 'proj-1',
      selectedProvider: 'provider-auth-required',
      selectedModel: 'model-1',
      selectedThinkingEffort: 'medium',
      sessionConfigOptions: JSON.stringify([
        {
          id: 'model',
          name: 'Model',
          description: '',
          type: 'string',
          options: [{ value: 'model-2' }],
        },
      ]),
      mode: 'local' as const,
      project: {
        id: 'proj-1',
        path: '/tmp',
        repoRoot: '/tmp',
      },
    };

    const localDb = {
      query: {
        sessions: {
          findFirst: () => Promise.resolve(sessionRecordVal),
        },
      },
    } as unknown as DbClient;

    const manager = new SessionManager(
      localDb,
      mockWorkspaceManager,
      registry,
      eventBus,
      noopLogger,
      fakeRuntime,
    );

    const updateConfigOption = vi.fn(() => Promise.resolve());
    Object.defineProperty(manager, 'stateMachine', {
      value: {
        getSession: () => ({
          isDead: false,
          updateConfigOption,
        }),
      },
    });

    // Should NOT throw an error when configuring provider requiring auth
    await expect(manager.setConfigOption('sess-1', 'model', 'model-2')).resolves.not.toThrow();

    expect(updateConfigOption).toHaveBeenCalledWith('model', 'model-2');
  });
});
