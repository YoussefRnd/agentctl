import { eq } from 'drizzle-orm';
import { test, it, expect, describe, vi } from 'vitest';
import { SessionManager, resolveAgentSessionId, type IEventBus } from './manager.js';
import type { SessionRuntime } from './runtime/session-runtime.js';
import type { DbClient } from '../db/index.js';
import type { ProviderRegistry } from '../providers/provider-registry.js';
import { Provider } from '../providers/provider.js';
import { noopLogger } from '../logger.js';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { AgentDriver } from '../agent/types.js';
import type { ChildProcess } from 'node:child_process';
import { createDatabase } from '../db/index.js';
import { projects, sessions, providers, sessionEvents } from '../db/schema.js';
import { SessionEventRepository } from './persistence/session-event-repository.js';
import { EMPTY_AGENT_FEATURES, type AgentConfigOption } from '@agentctl/shared';
import { WorkspaceManager } from '../git/worktree-manager.js';
import { GitMutex } from '../git/mutex.js';
import { simpleGit } from 'simple-git';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('SessionManager tests', () => {
  const mockDb = {
    select: () => ({
      from: () => ({
        where: () => {
          const p = Promise.resolve([]);
          return Object.assign(p, {
            orderBy: () =>
              Object.assign(Promise.resolve([]), {
                offset: () => ({ limit: () => ({ get: () => undefined }) }),
              }),
            get: () => undefined,
            run: () => undefined,
          });
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => {
          const p = Promise.resolve([{ id: 1, selectedProvider: 'provider-1' }]);
          return Object.assign(p, {
            returning: () =>
              Object.assign(Promise.resolve([{ id: 1, selectedProvider: 'provider-1' }]), {
                get: () => ({
                  id: 1,
                  sessionId: 'session-1',
                  selectedProvider: 'provider-1',
                  createdAt: new Date(),
                }),
              }),
            run: () => undefined,
          });
        },
      }),
    }),
    insert: () => ({
      values: (value: object) => ({
        returning: () =>
          Object.assign(Promise.resolve([{ ...value, id: 1, createdAt: new Date() }]), {
            get: () => ({ ...value, id: 1, sequence: 1, createdAt: new Date() }),
          }),
        run: () => undefined,
        onConflictDoUpdate: () => Promise.resolve(),
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

  (
    mockDb as unknown as { transaction: (callback: (tx: DbClient) => unknown) => unknown }
  ).transaction = (callback) => callback(mockDb);

  function inputDatabase() {
    const db = createDatabase(':memory:');
    db.insert(projects).values({ id: 'project-1', name: 'Project', path: '/tmp/project-1' }).run();
    db.insert(sessions)
      .values({
        id: 'session-1',
        projectId: 'project-1',
        agent: 'provider-1',
        selectedProvider: 'provider-1',
        worktreePath: '/tmp/project-1',
        taskSlug: 'task',
        branch: 'main',
        baseCommit: 'none',
      })
      .run();
    return db;
  }

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
          installError: null,
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
          installError: null,
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

  const fakeRuntime: AgentDriver = {
    startSession() {
      const fakeChild = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: () => true,
      }) as unknown as ChildProcess;

      return Promise.resolve({
        id: 'session-id-123',
        history: 'fresh',
        closed: new Promise<void>(() => undefined),
        onError(handler) {
          fakeChild.on('error', handler);
        },
        onClose(handler) {
          fakeChild.once('exit', (code, signal) => handler({ code, signal }));
        },
        prompt: (_text: string, _attachments?: unknown[], _embedded?: string) =>
          Promise.resolve({ stopReason: 'end_turn' }),
        authenticate: () => Promise.resolve(),
        cancel: () => Promise.resolve(),
        close: () => Promise.resolve(),
      });
    },
    inspectProvider() {
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

  test('startInput acknowledges a persisted message before the provider turn ends', async () => {
    const db = inputDatabase();
    const manager = new SessionManager(
      db,
      mockWorkspaceManager,
      mockProviderRegistry,
      eventBus,
      noopLogger,
      fakeRuntime,
    );
    let finish!: () => void;
    const turn = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const prompt = vi.fn(async () => {
      await turn;
    });
    vi.spyOn(manager, 'getOrResuscitate').mockResolvedValue({
      requiresHistoryContext: false,
      bindAttempt: async () => {},
      prompt,
    } as unknown as SessionRuntime);
    const id = await manager.startInput('session-1', 'hello');
    expect((await db.query.sessionEvents.findFirst())?.id).toBe(id);
    finish();
    await manager.waitForSessionOperations('session-1');
    expect(prompt).toHaveBeenCalledOnce();
  });

  test('startInput rejects an unavailable session before acceptance', async () => {
    const db = inputDatabase();
    const manager = new SessionManager(
      db,
      mockWorkspaceManager,
      mockProviderRegistry,
      eventBus,
      noopLogger,
      fakeRuntime,
    );
    await expect(manager.startInput('missing', 'hello')).rejects.toThrow('Session is unavailable');
    expect(await db.query.sessionEvents.findFirst()).toBeUndefined();
  });

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
      inputDatabase(),
      mockWorkspaceManager,
      mockProviderRegistry,
      eventBus,
      noopLogger,
      fakeRuntime,
    );

    // 1. Session is not in memory. Send message, it should resuscitate (load from DB and startSession)
    expect(manager.getSession('session-1')).toBeUndefined();

    let restarted = false;
    // Let's spy on restartSession
    const originalRestart = manager.restartSession.bind(manager);
    manager.restartSession = async (id: string) => {
      restarted = true;
      return originalRestart(id);
    };

    await manager.handleClientMessage('session-1', 'session.input', { input: 'hello' });
    await manager.waitForSessionOperations('session-1');

    expect(restarted).toBe(true);
    const session = manager.getSession('session-1');
    expect(session).toBeDefined();
    expect(session?.isDead).toBe(false);

    // 2. Kill the session (making it dead). Sending message again should trigger resuscitation.
    session?.kill();
    expect(session?.isDead).toBe(true);

    restarted = false;
    await manager.handleClientMessage('session-1', 'session.input', { input: 'hello again' });
    await manager.waitForSessionOperations('session-1');

    expect(restarted).toBe(true);
    const newSession = manager.getSession('session-1');
    expect(newSession).toBeDefined();
    expect(newSession?.isDead).toBe(false);

    newSession?.kill();
  });

  test('model switching restores a missing worktree and replaces its live runtime before configuring the model', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-model-recovery-'));
    let manager: SessionManager | undefined;
    try {
      const repoPath = path.join(tempDir, 'repo');
      await fs.mkdir(repoPath);
      const git = simpleGit(repoPath);
      await git.init();
      await git.addConfig('user.name', 'Test');
      await git.addConfig('user.email', 'test@example.com');
      await git.addConfig('commit.gpgSign', 'false');
      await fs.writeFile(path.join(repoPath, 'file.txt'), 'baseline');
      await git.add('file.txt');
      await git.commit('Initial');
      const db = createDatabase(':memory:');
      await db.insert(projects).values({
        id: 'model-recovery-project',
        name: 'Project',
        path: repoPath,
        repoRoot: repoPath,
      });
      const [providerRow] = await db
        .insert(providers)
        .values({
          id: 'model-recovery-provider',
          name: 'Dynamic Provider',
          command: 'test-agent',
          installState: 'installed_local',
          authState: 'authenticated',
          supportsDynamicModel: true,
        })
        .returning();
      const provider = new Provider(providerRow);
      const registry = {
        ensureProviderReady: async () => provider,
        getSettings: async () => ({ defaultProviderId: provider.id, defaultToWorktree: 'true' }),
      } as unknown as ProviderRegistry;
      const startRuntime = vi.fn<AgentDriver['startSession']>(async (...args) => {
        // The provider must never receive a missing cwd.
        expect((await fs.stat(args[2].cwd)).isDirectory()).toBe(true);
        return fakeRuntime.startSession(...args);
      });
      const workspaceManager = new WorkspaceManager(
        new GitMutex(),
        path.join(tempDir, 'worktrees'),
      );
      manager = new SessionManager(db, workspaceManager, registry, eventBus, noopLogger, {
        ...fakeRuntime,
        startSession: startRuntime,
      });
      const { sessionId } = await manager.createSession({
        projectId: 'model-recovery-project',
        selectedModel: 'model-1',
      });
      const active = await manager.restartSession(sessionId);
      const updateOldModel = vi.spyOn(active, 'updateModel');
      const record = await db.query.sessions.findFirst();
      if (!record) throw new Error('Missing test session');
      await fs.rm(record.worktreePath, { recursive: true });

      const replacement = await manager.updateSessionConfig(sessionId, {
        selectedProvider: provider.id,
        selectedModel: 'model-2',
        selectedThinkingEffort: 'medium',
      });

      expect(replacement).not.toBe(active);
      expect(active.isDead).toBe(true);
      expect(updateOldModel).not.toHaveBeenCalled();
      expect(startRuntime).toHaveBeenCalledTimes(2);
      expect(startRuntime.mock.calls[1][2]).toMatchObject({
        cwd: record.worktreePath,
        selectedModel: 'model-2',
      });
      expect((await db.query.sessions.findFirst())?.selectedModel).toBe('model-2');
    } finally {
      await manager?.stopAll();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('SessionManager updateSessionConfig updates dynamically when supported, otherwise restarts', async () => {
    // Mock provider with dynamic features enabled
    const dynamicProvider = new Provider({
      id: 'provider-dynamic',
      name: 'Dynamic Provider',
      installState: 'installed_local',
      installError: null,
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
      sessionConfigOptions: '',
      mode: 'local' as const,
      project: {
        id: 'proj-1',
        path: '/tmp',
        repoRoot: '/tmp',
      },
    };

    const localDb = {
      ...mockDb,
      transaction: (callback: (tx: DbClient) => unknown) => callback(mockDb),
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
                run: () => undefined,
              });
            },
          };
        },
      }),
      query: {
        providers: mockDb.query.providers,
        projects: mockDb.query.projects,
        sessions: {
          findFirst: () => Promise.resolve({ ...sessionRecordVal }),
          findMany: () => Promise.resolve([]),
        },
      },
    } as unknown as DbClient;

    const initialLiveOptions: AgentConfigOption[] = [
      {
        id: 'effort',
        name: 'Thinking Effort',
        category: 'thought_level',
        type: 'select',
        currentValue: 'medium',
        options: [{ value: 'medium', name: 'Medium' }],
      },
    ];
    const updatedLiveOptions: AgentConfigOption[] = [
      {
        ...initialLiveOptions[0],
        options: [
          { value: 'medium', name: 'Medium' },
          { value: 'high', name: 'High' },
        ],
      },
    ];
    const liveRuntime: AgentDriver = {
      ...fakeRuntime,
      async startSession(...args) {
        const handle = await fakeRuntime.startSession(...args);
        return { ...handle, configOptions: initialLiveOptions };
      },
    };
    const manager = new SessionManager(
      localDb,
      mockWorkspaceManager,
      registry,
      eventBus,
      noopLogger,
      liveRuntime,
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
      {
        sessions: { resume: false, fork: false, delete: false, list: false },
        prompts: { image: false, audio: false, embeddedContext: false },
        configuration: { model: true, options: true },
        authentication: { logout: false },
      },
    );

    expect(JSON.parse(sessionRecordVal.sessionConfigOptions)).toEqual(initialLiveOptions);

    let modelUpdated = '';
    let configUpdated: [string, string] | null = null;

    session.updateModel = async (modelId: string) => {
      modelUpdated = modelId;
      await session.handleDomainEvent({
        type: 'config_option_update',
        configOptions: updatedLiveOptions,
      });
      return updatedLiveOptions;
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

    expect(JSON.parse(sessionRecordVal.sessionConfigOptions)).toEqual(updatedLiveOptions);
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
    expect(configUpdated).toEqual(['effort', 'high']);
    expect(JSON.parse(sessionRecordVal.sessionConfigOptions)).toEqual(updatedLiveOptions);
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

  test('retains live config options notified before startup returns', async () => {
    const db = createDatabase(':memory:');
    await db.insert(projects).values({ id: 'startup-project', name: 'Startup', path: '/tmp' });
    await db.insert(sessions).values({
      id: 'startup-session',
      projectId: 'startup-project',
      branch: 'main',
      worktreePath: '/tmp',
      taskSlug: 'startup',
      baseCommit: 'test-commit',
      agent: 'provider-1',
      selectedProvider: 'provider-1',
      mode: 'local',
    });
    const liveOptions: AgentConfigOption[] = [
      {
        id: 'effort',
        name: 'Thinking Effort',
        category: 'thought_level',
        type: 'select',
        currentValue: 'default',
        options: [{ value: 'default', name: 'Default' }],
      },
    ];
    const runtime: AgentDriver = {
      ...fakeRuntime,
      async startSession(...args) {
        await args[3].onUpdate({ type: 'config_option_update', configOptions: liveOptions });
        return fakeRuntime.startSession(...args);
      },
    };
    const manager = new SessionManager(
      db,
      mockWorkspaceManager,
      mockProviderRegistry,
      eventBus,
      noopLogger,
      runtime,
    );
    const session = await manager.startSession('startup-session', '/tmp', 'node', [], {});
    try {
      const saved = await db.query.sessions.findFirst({
        where: (row, { eq }) => eq(row.id, 'startup-session'),
      });
      expect(JSON.parse(saved!.sessionConfigOptions)).toEqual(liveOptions);
    } finally {
      session.kill();
    }
  });

  test('restores an advertised agent persona on startup without sending approvalMode', async () => {
    const setMode = vi.fn(() => Promise.resolve());
    const runtime: AgentDriver = {
      ...fakeRuntime,
      startSession: () =>
        Promise.resolve({
          id: 'agent-session',
          availableModes: ['architect', 'coder'],
          history: 'fresh',
          closed: new Promise<void>(() => undefined),
          onError: vi.fn(),
          onClose: vi.fn(),
          prompt: () => Promise.resolve({ stopReason: 'end_turn' }),
          authenticate: () => Promise.resolve(),
          cancel: () => Promise.resolve(),
          close: () => Promise.resolve(),
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
    const update = vi.fn((_table: unknown) => ({
      set: () => ({ where: () => Object.assign(Promise.resolve(), { run: () => undefined }) }),
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
    expect(update.mock.calls.every((args) => args[0] !== sessions)).toBe(true);

    const setMode = vi.fn();
    Object.defineProperty(manager, 'runtimeRegistry', {
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

  test('legacy input accepts durably and exposes asynchronous dispatch failures', async () => {
    const db = inputDatabase();
    const manager = new SessionManager(
      db,
      mockWorkspaceManager,
      mockProviderRegistry,
      eventBus,
      noopLogger,
      fakeRuntime,
    );
    const session = await manager.startSession('session-1', '/tmp', 'agent', []);
    session.prompt = () => Promise.reject(new Error('prompt already in progress'));
    await manager.handleClientMessage('session-1', 'session.input', { input: 'second prompt' });
    await manager.waitForSessionOperations('session-1');
    const row = db.select().from(sessionEvents).get();
    expect(JSON.parse(row!.data ?? '{}')).toMatchObject({
      deliveryStatus: 'failed',
      deliveryError: 'prompt already in progress',
    });
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
    Object.defineProperty(manager, 'eventRepository', {
      value: { getEventWithMetadata },
    });

    await expect(manager.rewindSession('session-1', 99, 'conversation')).rejects.toThrow(
      'Event not found: 99',
    );
    expect(getEventWithMetadata).toHaveBeenCalledWith('session-1', 99);
  });

  test('rewind fork mode does not require the event to exist and forks the full history', async () => {
    const manager = new SessionManager(
      mockDb,
      mockWorkspaceManager,
      mockProviderRegistry,
      eventBus,
      noopLogger,
      fakeRuntime,
    );
    const getEventWithMetadata = vi.fn(() => Promise.resolve(null));
    Object.defineProperty(manager, 'eventRepository', {
      value: { getEventWithMetadata },
    });
    Object.defineProperty(manager, 'db', {
      value: {
        query: mockDb.query,
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () =>
                Promise.resolve([
                  { id: 1, type: 'text' },
                  { id: 2, type: 'text' },
                ]),
            }),
          }),
        }),
      },
    });
    const createForkSession = vi.fn(() => Promise.resolve('fork-1'));
    Object.defineProperty(manager, 'createForkSession', { value: createForkSession });

    const result = await manager.rewindSession('session-1', 999999999, 'fork');

    expect(result).toEqual({ forkSessionId: 'fork-1' });
    expect(getEventWithMetadata).not.toHaveBeenCalled();
    expect(createForkSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'session-1' }),
      [
        { id: 1, type: 'text' },
        { id: 2, type: 'text' },
      ],
      undefined,
    );
  });

  test.each([
    { status: 'idle', cutoff: 99, expected: 'source-agent-id' },
    { status: 'running', cutoff: 99, expected: undefined },
    { status: 'idle', cutoff: 1, expected: undefined },
  ])(
    'fork routes provider context only for complete idle history ($status, $cutoff)',
    async ({ status, cutoff, expected }) => {
      const db = createDatabase(':memory:');
      await db
        .insert(projects)
        .values({ id: 'fork-project', name: 'Fork', path: '/tmp/fork-project' });
      await db.insert(sessions).values({
        id: 'fork-source',
        projectId: 'fork-project',
        taskSlug: 'source',
        branch: 'main',
        worktreePath: '/tmp/fork-project',
        mode: 'local',
        agent: 'provider-1',
        selectedProvider: 'provider-1',
        status: status as 'idle' | 'running',
        agentSessionId: JSON.stringify({ 'provider-1': 'source-agent-id' }),
        baseCommit: 'none',
      });
      const originalStartSession = fakeRuntime.startSession.bind(fakeRuntime);
      const prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });
      const startSession = vi.fn<AgentDriver['startSession']>(async (...args) => {
        const handle = await originalStartSession(...args);
        return {
          ...handle,
          prompt,
          ...(args[2].intent.kind === 'fork'
            ? {
                id: 'fork-agent-id',
                history: 'restored' as const,
              }
            : {}),
        };
      });
      const manager = new SessionManager(
        db,
        mockWorkspaceManager,
        mockProviderRegistry,
        eventBus,
        noopLogger,
        { ...fakeRuntime, startSession },
      );
      const store = new SessionEventRepository(db, eventBus);
      const first = await store.append(
        'fork-source',
        'text',
        { text: 'First', role: 'user' },
        null,
      );
      await store.append('fork-source', 'text', { text: 'Second', role: 'provider' }, null);
      const result = await manager.rewindSession(
        'fork-source',
        cutoff === 1 ? first : Number.MAX_SAFE_INTEGER,
        'fork',
      );
      expect(result.forkSessionId).toBeTruthy();
      expect(startSession).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          intent: expected ? { kind: 'fork', sessionId: expected } : { kind: 'new' },
          localSessionId: result.forkSessionId,
          cwd: '/tmp/fork-project',
        }),
        expect.any(Object),
      );
      const forkRecord = await db.query.sessions.findFirst({
        where: (row, { eq }) => eq(row.id, result.forkSessionId!),
      });
      expect(JSON.parse(forkRecord!.agentSessionId!)).toEqual({
        'provider-1': expected ? 'fork-agent-id' : 'session-id-123',
      });
      await manager.handleClientMessage(result.forkSessionId!, 'session.input', {
        input: 'Continue fork',
      });
      await manager.waitForSessionOperations(result.forkSessionId!);
      expect(prompt.mock.calls[0][0]).toBe('Continue fork');
      const context = prompt.mock.calls[0][2] ?? '';
      if (expected) expect(context).not.toContain('<previous_conversation_context>');
      else expect(context).toContain('[User]: First');
    },
  );

  test('SessionManager deleteSession calls driver deleteSession if agentSessionId is present', async () => {
    let deletedAgentSessionId = '';
    const spyRuntime: AgentDriver = {
      ...fakeRuntime,
      deleteSession(_cmd, _args, _env, acpSessionId) {
        deletedAgentSessionId = acpSessionId;
        return Promise.resolve();
      },
    };

    const db = inputDatabase();
    db.update(sessions)
      .set({ agentSessionId: 'agent-session-abc' })
      .where(eq(sessions.id, 'session-1'))
      .run();
    const manager = new SessionManager(
      db,
      mockWorkspaceManager,
      mockProviderRegistry,
      eventBus,
      noopLogger,
      spyRuntime,
    );
    await manager.deleteSession('session-1');
    expect(deletedAgentSessionId).toBe('agent-session-abc');
  });

  test('SessionManager updateSessionConfig allows selecting provider requiring auth', async () => {
    const authProvider = new Provider({
      id: 'provider-auth-required',
      name: 'Auth Required Provider',
      installState: 'installed_local',
      installError: null,
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
      ...mockDb,
      update: () => ({
        set: () => ({
          where: () => Object.assign(Promise.resolve(), { run: () => undefined }),
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

    manager.restartSession = vi.fn(() => Promise.resolve({} as unknown as SessionRuntime));

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
      installError: null,
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
      ...mockDb,
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
    Object.defineProperty(manager, 'runtimeRegistry', {
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

  describe('resolveAgentSessionId', () => {
    it('returns null if rawAgentSessionId is null or empty', () => {
      expect(resolveAgentSessionId(null, 'provider-a', 'provider-a')).toBeNull();
      expect(resolveAgentSessionId('', 'provider-a', 'provider-a')).toBeNull();
    });

    it('parses JSON map and returns session ID for matching target provider', () => {
      const map = JSON.stringify({
        'provider-a': 'sess-a-123',
        'provider-b': 'sess-b-456',
      });
      expect(resolveAgentSessionId(map, 'provider-a', 'provider-a')).toBe('sess-a-123');
      expect(resolveAgentSessionId(map, 'provider-b', 'provider-a')).toBe('sess-b-456');
      expect(resolveAgentSessionId(map, 'provider-c', 'provider-a')).toBeNull();
    });

    it('handles legacy plain string format: returns string only for original provider, null for new provider', () => {
      const legacyId = 'legacy-sess-uuid';
      // Original provider matches target provider -> returns legacy string
      expect(resolveAgentSessionId(legacyId, 'provider-a', 'provider-a')).toBe('legacy-sess-uuid');
      // Target provider is different -> returns null to prevent passing legacy ID to new agent
      expect(resolveAgentSessionId(legacyId, 'provider-b', 'provider-a')).toBeNull();
    });
  });

  describe('handleClientMessage / sendUserAction history context injection', () => {
    it('injects history transcript as embeddedContext when prompt is sent to a new provider for the first time', async () => {
      const db = createDatabase(':memory:');
      await db.insert(projects).values({
        id: 'proj-1',
        name: 'test-project',
        path: '/tmp/test',
      });
      await db.insert(sessions).values({
        id: 'sess-history-test',
        projectId: 'proj-1',
        branch: 'main',
        worktreePath: '/tmp/test',
        taskSlug: 'test',
        agent: 'provider-a',
        title: 'history test',
        status: 'idle',
        selectedProvider: 'provider-b',
        agentSessionId: JSON.stringify({ 'provider-a': 'agent-sess-1' }),
        baseCommit: 'hash',
      });

      const store = new SessionEventRepository(db, {
        publish() {
          /* noop */
        },
      });
      await store.append(
        'sess-history-test',
        'text',
        { text: 'Create login page', role: 'user' },
        null,
      );
      await store.append(
        'sess-history-test',
        'text',
        { text: 'Created login page', role: 'provider' },
        null,
      );

      const mockPrompt = vi.fn().mockResolvedValue(undefined);
      const manager = new SessionManager(
        db,
        mockWorkspaceManager,
        mockProviderRegistry,
        eventBus,
        noopLogger,
        fakeRuntime,
      );

      vi.spyOn(manager, 'getOrResuscitate').mockResolvedValue({
        prompt: mockPrompt,
        bindAttempt: async () => {},
      } as unknown as SessionRuntime);

      await manager.handleClientMessage('sess-history-test', 'session.input', {
        input: 'Add validation',
      });
      await manager.waitForSessionOperations('sess-history-test');

      expect(mockPrompt.mock.calls[0].slice(0, 3)).toEqual([
        'Add validation',
        [],
        expect.stringContaining('<previous_conversation_context>'),
      ]);
      expect(mockPrompt.mock.calls[0][2]).toContain('[User]: Create login page');
      expect(mockPrompt.mock.calls[0][2]).toContain('[Assistant]: Created login page');
    });

    it('transfers copied fork history once even after the fresh provider session id is saved', async () => {
      const db = createDatabase(':memory:');
      await db.insert(projects).values({
        id: 'proj-1',
        name: 'test-project',
        path: '/tmp/test',
      });
      await db.insert(sessions).values({
        id: 'sess-history-test',
        projectId: 'proj-1',
        branch: 'main',
        worktreePath: '/tmp/test',
        taskSlug: 'test',
        agent: 'provider-a',
        title: 'history test',
        status: 'idle',
        selectedProvider: 'provider-b',
        agentSessionId: JSON.stringify({ 'provider-b': 'fresh-fork-agent-session' }),
        baseCommit: 'hash',
      });

      const store = new SessionEventRepository(db, {
        publish() {
          /* noop */
        },
      });
      await store.append(
        'sess-history-test',
        'text',
        { text: 'Create login page', role: 'user' },
        null,
      );
      await store.append(
        'sess-history-test',
        'text',
        { text: 'Created login page', role: 'provider' },
        null,
      );

      const mockPrompt = vi.fn().mockResolvedValue(undefined);
      const manager = new SessionManager(
        db,
        mockWorkspaceManager,
        mockProviderRegistry,
        eventBus,
        noopLogger,
        fakeRuntime,
      );

      const forkSession = {
        prompt: mockPrompt,
        bindAttempt: async () => {},
        requiresHistoryContext: true,
        markHistoryContextTransferred() {
          this.requiresHistoryContext = false;
        },
      };
      vi.spyOn(manager, 'getOrResuscitate').mockResolvedValue(
        forkSession as unknown as SessionRuntime,
      );

      await manager.handleClientMessage('sess-history-test', 'session.input', {
        input: 'Add validation',
      });
      await manager.waitForSessionOperations('sess-history-test');

      expect(mockPrompt.mock.calls[0].slice(0, 3)).toEqual([
        'Add validation',
        [],
        expect.stringContaining('<previous_conversation_context>'),
      ]);
      expect(mockPrompt.mock.calls[0][2]).toContain('[User]: Create login page');
      expect(mockPrompt.mock.calls[0][2]).toContain('[Assistant]: Created login page');
      await manager.handleClientMessage('sess-history-test', 'session.input', { input: 'Next' });
      await manager.waitForSessionOperations('sess-history-test');
      expect(mockPrompt.mock.calls.at(-1)?.slice(0, 3)).toEqual(['Next', [], undefined]);
    });

    it.each([false, true])(
      'does not replay provider-owned history after an initially empty prompt (fresh=%s)',
      async (fresh) => {
        const db = createDatabase(':memory:');
        await db.insert(projects).values({
          id: 'proj-1',
          name: 'test-project',
          path: '/tmp/test',
        });
        await db.insert(sessions).values({
          id: 'sess-existing-test',
          projectId: 'proj-1',
          branch: 'main',
          worktreePath: '/tmp/test',
          taskSlug: 'test',
          agent: 'provider-b',
          title: 'existing test',
          status: 'idle',
          selectedProvider: 'provider-b',
          agentSessionId: JSON.stringify({ 'provider-b': 'agent-sess-2' }),
          baseCommit: 'hash',
        });

        const store = new SessionEventRepository(db, {
          publish() {
            /* noop */
          },
        });
        if (!fresh) {
          await store.append('sess-existing-test', 'text', { text: 'Hello', role: 'user' }, null);
        }

        const mockPrompt = vi.fn().mockResolvedValue(undefined);
        const manager = new SessionManager(
          db,
          mockWorkspaceManager,
          mockProviderRegistry,
          eventBus,
          noopLogger,
          fakeRuntime,
        );

        const activeSession = {
          prompt: mockPrompt,
          bindAttempt: async () => {},
          requiresHistoryContext: fresh,
          markHistoryContextTransferred() {
            this.requiresHistoryContext = false;
          },
        };
        vi.spyOn(manager, 'getOrResuscitate').mockResolvedValue(
          activeSession as unknown as SessionRuntime,
        );

        await manager.handleClientMessage('sess-existing-test', 'session.input', {
          input: 'Followup message',
        });
        await manager.waitForSessionOperations('sess-existing-test');

        expect(mockPrompt.mock.calls[0].slice(0, 3)).toEqual(['Followup message', [], undefined]);
        await store.append(
          'sess-existing-test',
          'text',
          { text: 'Followup message', role: 'user' },
          null,
        );
        await manager.handleClientMessage('sess-existing-test', 'session.input', { input: 'Next' });
        await manager.waitForSessionOperations('sess-existing-test');
        expect(mockPrompt.mock.calls.at(-1)?.slice(0, 3)).toEqual(['Next', [], undefined]);
      },
    );
  });

  describe('createSession provider resolution & smarter fallbacks', () => {
    const createTestProvider = (id: string, name = id) =>
      new Provider({
        id,
        name,
        installState: 'installed_local',
        installError: null,
        authState: 'authenticated',
        enabled: true,
        hidden: false,
        distribution: '{}',
        command: 'node',
        launchArgs: '[]',
        launchEnv: '{}',
        customEnv: '{}',
        configOptions: JSON.stringify([
          {
            id: 'model',
            name: 'Model',
            type: 'select',
            options: [
              { value: 'default', name: 'Default' },
              { value: 'custom-model', name: 'Custom Model' },
            ],
            currentValue: 'default',
          },
          {
            id: 'thinking',
            name: 'Thinking',
            type: 'select',
            options: [
              { value: 'low', name: 'Low' },
              { value: 'medium', name: 'Medium' },
              { value: 'high', name: 'High' },
            ],
            currentValue: 'medium',
          },
        ]),
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
      });

    it('saves first-message settings before any agent process starts', async () => {
      const db = createDatabase(':memory:');
      await db
        .insert(projects)
        .values({ id: 'proj-draft', name: 'Draft', path: '/tmp/proj-draft' });
      const provider = createTestProvider('draft-provider');
      const discovery = provider.toDiscovery.bind(provider);
      provider.toDiscovery = () => ({ ...discovery(), modes: ['build', 'plan'] });
      const registry = {
        ensureProviderReady: () => Promise.resolve(provider),
        getSettings: () => Promise.resolve({}),
      } as unknown as ProviderRegistry;
      const runtime = { ...fakeRuntime, startSession: vi.fn(fakeRuntime.startSession) };
      const manager = new SessionManager(
        db,
        mockWorkspaceManager,
        registry,
        eventBus,
        noopLogger,
        runtime,
      );
      const { sessionId } = await manager.createSession({
        projectId: 'proj-draft',
        taskSlug: 'draft',
        mode: 'local',
        providerId: 'draft-provider',
        selectedModel: 'custom-model',
        selectedThinkingEffort: 'high',
        approvalMode: 'auto_approve',
        agentPersona: 'plan',
      });
      const saved = await db.query.sessions.findFirst({
        where: (row, { eq }) => eq(row.id, sessionId),
      });
      expect(saved).toMatchObject({
        selectedProvider: 'draft-provider',
        selectedModel: 'custom-model',
        selectedThinkingEffort: 'high',
        approvalMode: 'auto_approve',
        agentPersona: 'plan',
      });
      expect(JSON.parse(saved!.availableAgentPersonas)).toEqual(['build', 'plan']);
      expect(runtime.startSession).not.toHaveBeenCalled();
      const restart = vi.spyOn(manager, 'restartSession').mockResolvedValue({} as SessionRuntime);
      await manager.updateSessionConfig(sessionId, {
        selectedProvider: 'different-provider',
        selectedModel: 'custom-model',
        selectedThinkingEffort: 'high',
      });
      const switched = await db.query.sessions.findFirst({
        where: (row, { eq }) => eq(row.id, sessionId),
      });
      expect(switched?.agentPersona).toBeNull();
      expect(restart).toHaveBeenCalledWith(sessionId);

      await expect(
        manager.createSession({
          projectId: 'proj-draft',
          taskSlug: 'invalid',
          providerId: 'draft-provider',
          agentPersona: 'missing',
        }),
      ).rejects.toThrow('Agent persona is not available');
      expect(await db.select().from(sessions)).toHaveLength(1);
    });

    it('inherits provider, model, and thinking effort from the most recent project session when providerId is omitted', async () => {
      const db = createDatabase(':memory:');
      await db.insert(projects).values({
        id: 'proj-inherit',
        name: 'Inherit Project',
        path: '/tmp/proj-inherit',
      });

      // Older session
      await db.insert(sessions).values({
        id: 'sess-old',
        projectId: 'proj-inherit',
        branch: 'main',
        worktreePath: '/tmp/proj-inherit',
        taskSlug: 'old-task',
        agent: 'provider-old',
        title: 'old session',
        status: 'idle',
        selectedProvider: 'provider-old',
        selectedModel: 'old-model',
        selectedThinkingEffort: 'low',
        baseCommit: 'hash1',
        createdAt: new Date(Date.now() - 10000),
      });

      // Most recent session
      await db.insert(sessions).values({
        id: 'sess-latest',
        projectId: 'proj-inherit',
        branch: 'main',
        worktreePath: '/tmp/proj-inherit',
        taskSlug: 'latest-task',
        agent: 'provider-custom',
        title: 'latest session',
        status: 'idle',
        selectedProvider: 'provider-custom',
        selectedModel: 'custom-model',
        selectedThinkingEffort: 'high',
        baseCommit: 'hash2',
        createdAt: new Date(Date.now()),
      });

      const registry = {
        ensureProviderReady: (id: string) => Promise.resolve(createTestProvider(id)),
        getSettings: () => Promise.resolve({ defaultProviderId: 'provider-default' }),
        discover: () => Promise.resolve([createTestProvider('provider-default')]),
      } as unknown as ProviderRegistry;

      const manager = new SessionManager(
        db,
        mockWorkspaceManager,
        registry,
        eventBus,
        noopLogger,
        fakeRuntime,
      );

      const { sessionId } = await manager.createSession({
        projectId: 'proj-inherit',
        taskSlug: 'new-session-inherit',
        mode: 'local',
      });

      const created = await db.query.sessions.findFirst({
        where: (s, { eq }) => eq(s.id, sessionId),
      });

      expect(created).toBeDefined();
      expect(created?.selectedProvider).toBe('provider-custom');
      expect(created?.selectedModel).toBe('custom-model');
      expect(created?.selectedThinkingEffort).toBe('high');
    });

    it('falls back to defaultProviderId when project has no previous sessions', async () => {
      const db = createDatabase(':memory:');
      await db.insert(projects).values({
        id: 'proj-fresh',
        name: 'Fresh Project',
        path: '/tmp/proj-fresh',
      });

      const registry = {
        ensureProviderReady: (id: string) => Promise.resolve(createTestProvider(id)),
        getSettings: () => Promise.resolve({ defaultProviderId: 'provider-global-default' }),
        discover: () => Promise.resolve([createTestProvider('provider-global-default')]),
      } as unknown as ProviderRegistry;

      const manager = new SessionManager(
        db,
        mockWorkspaceManager,
        registry,
        eventBus,
        noopLogger,
        fakeRuntime,
      );

      const { sessionId } = await manager.createSession({
        projectId: 'proj-fresh',
        taskSlug: 'fresh-task',
        mode: 'local',
      });

      const created = await db.query.sessions.findFirst({
        where: (s, { eq }) => eq(s.id, sessionId),
      });

      expect(created).toBeDefined();
      expect(created?.selectedProvider).toBe('provider-global-default');
    });

    it('falls back to discoverable ready provider when defaultProviderId is unset and no previous sessions exist', async () => {
      const db = createDatabase(':memory:');
      await db.insert(projects).values({
        id: 'proj-no-default',
        name: 'No Default Project',
        path: '/tmp/proj-no-default',
      });

      const registry = {
        ensureProviderReady: (id: string) => Promise.resolve(createTestProvider(id)),
        getSettings: () => Promise.resolve({ defaultProviderId: undefined }),
        discover: () =>
          Promise.resolve([
            createTestProvider('provider-discovered-1'),
            createTestProvider('provider-discovered-2'),
          ]),
      } as unknown as ProviderRegistry;

      const manager = new SessionManager(
        db,
        mockWorkspaceManager,
        registry,
        eventBus,
        noopLogger,
        fakeRuntime,
      );

      const { sessionId } = await manager.createSession({
        projectId: 'proj-no-default',
        taskSlug: 'discovered-task',
        mode: 'local',
      });

      const created = await db.query.sessions.findFirst({
        where: (s, { eq }) => eq(s.id, sessionId),
      });

      expect(created).toBeDefined();
      expect(created?.selectedProvider).toBe('provider-discovered-1');
    });

    it('respects explicit providerId even if project has previous sessions', async () => {
      const db = createDatabase(':memory:');
      await db.insert(projects).values({
        id: 'proj-override',
        name: 'Override Project',
        path: '/tmp/proj-override',
      });

      await db.insert(sessions).values({
        id: 'sess-prev',
        projectId: 'proj-override',
        branch: 'main',
        worktreePath: '/tmp/proj-override',
        taskSlug: 'prev-task',
        agent: 'provider-previous',
        title: 'previous session',
        status: 'idle',
        selectedProvider: 'provider-previous',
        selectedModel: 'custom-model',
        selectedThinkingEffort: 'high',
        baseCommit: 'hash1',
      });

      const registry = {
        ensureProviderReady: (id: string) => Promise.resolve(createTestProvider(id)),
        getSettings: () => Promise.resolve({ defaultProviderId: 'provider-global-default' }),
        discover: () => Promise.resolve([createTestProvider('provider-global-default')]),
      } as unknown as ProviderRegistry;

      const manager = new SessionManager(
        db,
        mockWorkspaceManager,
        registry,
        eventBus,
        noopLogger,
        fakeRuntime,
      );

      const { sessionId } = await manager.createSession({
        projectId: 'proj-override',
        providerId: 'provider-explicit',
        taskSlug: 'explicit-task',
        mode: 'local',
      });

      const created = await db.query.sessions.findFirst({
        where: (s, { eq }) => eq(s.id, sessionId),
      });

      expect(created).toBeDefined();
      expect(created?.selectedProvider).toBe('provider-explicit');
    });

    it('throws error when no providers are available or ready', async () => {
      const db = createDatabase(':memory:');
      await db.insert(projects).values({
        id: 'proj-none',
        name: 'None Project',
        path: '/tmp/proj-none',
      });

      const registry = {
        ensureProviderReady: () => Promise.reject(new Error('Provider not ready')),
        getSettings: () => Promise.resolve({ defaultProviderId: undefined }),
        discover: () => Promise.resolve([]),
      } as unknown as ProviderRegistry;

      const manager = new SessionManager(
        db,
        mockWorkspaceManager,
        registry,
        eventBus,
        noopLogger,
        fakeRuntime,
      );

      await expect(
        manager.createSession({
          projectId: 'proj-none',
          taskSlug: 'none-task',
          mode: 'local',
        }),
      ).rejects.toThrow(
        'No agent provider is available or ready. Please configure or install an agent provider in settings.',
      );
    });
  });

  describe('restartSession empty session handling', () => {
    it('starts a new agent session when the local session has no text messages', async () => {
      const db = createDatabase(':memory:');
      await db.insert(projects).values({
        id: 'proj-empty',
        name: 'Empty Project',
        path: '/tmp/proj-empty',
      });
      await db.insert(sessions).values({
        id: 'sess-empty',
        projectId: 'proj-empty',
        branch: 'main',
        worktreePath: '/tmp/proj-empty',
        taskSlug: 'empty-task',
        agent: 'provider-1',
        title: 'Empty session',
        status: 'idle',
        selectedProvider: 'provider-1',
        agentSessionId: JSON.stringify({ 'provider-1': 'acp-empty-session' }),
        baseCommit: 'hash',
      });

      const provider = new Provider({
        id: 'provider-1',
        name: 'Provider 1',
        installState: 'installed_local',
        installError: null,
        authState: 'authenticated',
        enabled: true,
        hidden: false,
        distribution: '{}',
        command: 'claude',
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
        description: '',
        icon: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const registry = {
        ensureProviderReady: () => Promise.resolve(provider),
        getSettings: () => Promise.resolve({ defaultProviderId: 'provider-1' }),
        discover: () => Promise.resolve([provider.toDiscovery()]),
      } as unknown as ProviderRegistry;

      const manager = new SessionManager(
        db,
        mockWorkspaceManager,
        registry,
        eventBus,
        noopLogger,
        fakeRuntime,
      );

      const startSessionSpy = vi
        .spyOn(manager, 'startSession')
        .mockResolvedValue({} as SessionRuntime);

      await manager.restartSession('sess-empty');

      expect(startSessionSpy).toHaveBeenCalledWith(
        'sess-empty',
        '/tmp/proj-empty',
        'claude',
        [],
        {},
        'default',
        'medium',
        EMPTY_AGENT_FEATURES,
        undefined,
        { kind: 'new' },
        undefined,
      );
    });

    it('resumes the agent session when the local session has text history', async () => {
      const db = createDatabase(':memory:');
      await db.insert(projects).values({
        id: 'proj-active',
        name: 'Active Project',
        path: '/tmp/proj-active',
      });
      await db.insert(sessions).values({
        id: 'sess-active',
        projectId: 'proj-active',
        branch: 'main',
        worktreePath: '/tmp/proj-active',
        taskSlug: 'active-task',
        agent: 'provider-1',
        title: 'Active session',
        status: 'idle',
        selectedProvider: 'provider-1',
        agentSessionId: JSON.stringify({ 'provider-1': 'acp-active-session' }),
        baseCommit: 'hash',
      });

      const store = new SessionEventRepository(db, { publish() {} });
      await store.append('sess-active', 'text', { text: 'Hello', role: 'user' }, null);

      const provider = new Provider({
        id: 'provider-1',
        name: 'Provider 1',
        installState: 'installed_local',
        installError: null,
        authState: 'authenticated',
        enabled: true,
        hidden: false,
        distribution: '{}',
        command: 'claude',
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
        description: '',
        icon: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const registry = {
        ensureProviderReady: () => Promise.resolve(provider),
        getSettings: () => Promise.resolve({ defaultProviderId: 'provider-1' }),
        discover: () => Promise.resolve([provider.toDiscovery()]),
      } as unknown as ProviderRegistry;

      const manager = new SessionManager(
        db,
        mockWorkspaceManager,
        registry,
        eventBus,
        noopLogger,
        fakeRuntime,
      );

      const startSessionSpy = vi
        .spyOn(manager, 'startSession')
        .mockResolvedValue({} as SessionRuntime);

      await manager.restartSession('sess-active');

      expect(startSessionSpy).toHaveBeenCalledWith(
        'sess-active',
        '/tmp/proj-active',
        'claude',
        [],
        {},
        'default',
        'medium',
        EMPTY_AGENT_FEATURES,
        undefined,
        { kind: 'resume', sessionId: 'acp-active-session' },
        undefined,
      );
    });
  });
});

it('Stop does not launch a new provider runtime when no runtime is active', async () => {
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'p', name: 'Project', path: '/tmp' }).run();
  db.insert(sessions)
    .values({
      id: 's',
      projectId: 'p',
      worktreePath: '/tmp',
      taskSlug: 'task',
      branch: 'main',
      baseCommit: 'none',
      agent: 'provider',
      selectedProvider: 'provider',
    })
    .run();
  const runtime: AgentDriver = { startSession: vi.fn(), inspectProvider: vi.fn() };
  const manager = new SessionManager(
    db,
    {} as WorkspaceManager,
    {} as ProviderRegistry,
    { publish() {} },
    noopLogger,
    runtime,
  );
  await manager.handleClientMessage('s', 'cancel', {});
  expect(runtime.startSession).not.toHaveBeenCalled();
});
