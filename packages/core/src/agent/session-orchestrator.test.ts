import { test, expect, describe } from 'vitest';
import { SessionOrchestrator } from './session-orchestrator.js';
import { type DbClient } from './acp-session.js';
import type { WorktreeManager } from '../git/worktree-manager.js';
import type { ProviderRegistry } from './acp-provider-registry.js';
import type { SessionManager } from './session-manager.js';
import { Provider } from './provider.js';

describe('SessionOrchestrator', () => {
  test('create orchestrates project, provider, worktree and session', async () => {
    // Mock DB
    const mockDb = {
      query: {
        projects: {
          findFirst: async () => {
            await Promise.resolve();
            return {
              id: 'proj-1',
              path: '/path/to/proj',
              repoRoot: '/path/to/repo',
              subdir: 'src',
            };
          },
        },
      },
      insert: () => ({
        values: async () => {
          await Promise.resolve();
        },
      }),
    } as unknown as DbClient;

    // Mock WorktreeManager
    const mockWorktreeManager = {
      create: async () => {
        await Promise.resolve();
        return {
          branch: 'agentctl/session-1/slug',
          path: '/path/to/worktree',
          workspacePath: '/path/to/worktree/src',
          baseCommit: 'abc123',
        };
      },
    } as unknown as WorktreeManager;

    // Mock ProviderRegistry
    const mockProviderRegistry = {
      ensureProviderReady: async () => {
        await Promise.resolve();
        return new Provider({
          id: 'provider-1',
          name: 'Provider 1',
          status: 'ready',
          command: 'agent-cmd',
          enabled: true,
          launchArgs: '[]',
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
        });
      },
    } as unknown as ProviderRegistry;

    // Mock SessionManager
    const mockSessionManager = {
      startSession: (id: string, path: string) => ({ sessionId: id, cwd: path }),
    } as unknown as SessionManager;

    const orchestrator = new SessionOrchestrator(
      mockDb,
      mockWorktreeManager,
      mockProviderRegistry,
      mockSessionManager,
    );

    const session = await orchestrator.create({
      projectId: 'proj-1',
      providerId: 'provider-1',
      taskSlug: 'test-slug',
    });

    expect(session).toBeDefined();
    expect(session.sessionId).toBeDefined();
  });

  test('create throws if project not found', async () => {
    const mockDb = {
      query: {
        projects: {
          findFirst: async () => {
            await Promise.resolve();
            return null;
          },
        },
      },
    } as unknown as DbClient;

    const orchestrator = new SessionOrchestrator(
      mockDb,
      {} as WorktreeManager,
      {} as ProviderRegistry,
      {} as SessionManager,
    );

    await expect(orchestrator.create({
      projectId: 'missing',
      providerId: 'provider-1',
      taskSlug: 'slug'
    })).rejects.toThrow('Project not found');
  });
});
