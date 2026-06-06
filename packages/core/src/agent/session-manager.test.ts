import { test, expect, describe } from 'vitest';
import { SessionManager, type IEventBus } from './session-manager.js';
import type { DbClient } from './acp-session.js';
import type { WorkspaceManager } from '../git/worktree-manager.js';
import type { ProviderRegistry } from './acp-provider-registry.js';
import { Provider } from './provider.js';
import { noopLogger } from '../logger.js';

describe('SessionManager tests', () => {
  const mockDb = {
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: 1, createdAt: new Date() }]),
      }),
    }),
    query: {
      projects: {
        findFirst: async () => ({
          id: 'proj-1',
          path: '/tmp',
          repoRoot: '/tmp',
          subdir: '',
        }),
      },
      sessions: {
        findFirst: async () => ({
          id: 'sess-1',
          projectId: 'proj-1',
          selectedProvider: 'provider-1',
          selectedModel: 'model-1',
          selectedThinkingEffort: 'medium',
          mode: 'local',
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
    create: async () => ({
      path: '/tmp/worktree',
      workspacePath: '/tmp/worktree',
      branch: 'agentctl/test-branch',
      baseCommit: 'abc',
    }),
  } as unknown as WorkspaceManager;

  const mockProviderRegistry = {
    ensureProviderReady: async () => new Provider({
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
  } as unknown as ProviderRegistry;

  const eventBus = {
    publish: () => undefined,
  } as unknown as IEventBus;

  test('SessionManager startSession creates and initializes a session', () => {
    const manager = new SessionManager(mockDb, mockWorkspaceManager, mockProviderRegistry, eventBus, noopLogger);
    const session = manager.startSession('session-1', '/tmp', 'sleep', ['10'], {});

    expect(session).toBeDefined();
    expect(session.sessionId).toBe('session-1');

    session.kill();
  });

  test('SessionManager createSession orchestrates dependencies and starts session', async () => {
    const manager = new SessionManager(mockDb, mockWorkspaceManager, mockProviderRegistry, eventBus, noopLogger);
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
});
