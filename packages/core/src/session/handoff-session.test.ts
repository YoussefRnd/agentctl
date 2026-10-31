import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vite-plus/test';
import { createDatabase } from '../db/index.js';
import { projects, sessions, sessionEvents, sessionProviderContexts } from '../db/schema.js';
import type { WorkspaceManager } from '../git/worktree-manager.js';
import { noopLogger } from '../logger.js';
import { Provider } from '../providers/provider.js';
import type { ProviderRegistry } from '../providers/provider-registry.js';
import type { AgentDriver, AgentSessionOptions } from '../agent/types.js';
import { SessionManager } from './manager.js';

function createProvider(id: string): Provider {
  return new Provider({
    id,
    name: id,
    installState: 'installed_local',
    installError: null,
    authState: 'authenticated',
    enabled: true,
    hidden: false,
    distribution: '{}',
    command: id,
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
    description: 'test provider',
    icon: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe('SessionManager provider handoff', () => {
  it('keeps one chat, resumes returning providers, and delivers only missed history on the next input', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-handoff-session-'));
    vi.stubEnv('AGENTCTL_HOME', path.join(cwd, 'home'));
    vi.stubEnv('AGENTCTL_SKILLS_DIR', path.join(cwd, 'home', 'skills'));
    vi.stubEnv('AGENTCTL_SKILL_PATH', '');
    vi.stubEnv('AGENTCTL_WORKSPACE_SKILLS_DIR', path.join(cwd, 'workspace-skills'));
    const db = createDatabase(':memory:');
    await db.insert(projects).values({ id: 'project-1', name: 'project', path: cwd });
    await db.insert(sessions).values({
      id: 'session-1',
      projectId: 'project-1',
      branch: 'main',
      worktreePath: cwd,
      taskSlug: 'handoff-test',
      agent: 'source',
      title: 'Continue implementation',
      status: 'idle',
      selectedProvider: 'source',
      selectedModel: 'default',
      baseCommit: 'none',
      mode: 'local',
    });
    const providers = new Map([
      ['source', createProvider('source')],
      ['target', createProvider('target')],
    ]);
    const providerRegistry = {
      ensureProviderReady: (id: string) => Promise.resolve(providers.get(id)!),
      getSettings: () => Promise.resolve({ defaultProviderId: 'source' }),
      discover: () => Promise.resolve(Array.from(providers.values()).map((p) => p.toDiscovery())),
    } as unknown as ProviderRegistry;
    const executions: { options: AgentSessionOptions; prompt: ReturnType<typeof vi.fn> }[] = [];
    let reportFullContext = false;
    const runtime: AgentDriver = {
      inspectProvider: () =>
        Promise.resolve({
          status: 'ready',
          configOptions: [],
          authMethods: [],
          supportsDynamicModel: false,
          supportsDynamicConfig: false,
        }),
      startSession: async (_command, _args, options, callbacks) => {
        if (reportFullContext && options.intent?.kind === 'resume') {
          reportFullContext = false;
          await callbacks.onUpdate({ type: 'usage_update', used: 127_900, size: 128_000 });
        }
        const prompt = vi.fn(async (text: string) => {
          if (text === 'Before queued target') {
            await manager.startInput('session-1', 'Queued target request');
          }
          await callbacks.onUpdate({ type: 'text', text: `Answer to ${text}` });
          return text === 'Before queued target'
            ? {
                stopReason: 'error' as const,
                userMessageId: 'accepted-source-input',
                error: { code: -1, message: 'Transient provider error' },
              }
            : { stopReason: 'end_turn' as const };
        });
        executions.push({ options, prompt });
        return Promise.resolve({
          id:
            options.intent?.kind === 'resume'
              ? options.intent.sessionId
              : `${options.providerId}-native-${executions.length}`,
          history: options.intent?.kind === 'resume' ? 'restored' : 'fresh',
          closed: new Promise<void>(() => undefined),
          onError: () => undefined,
          onClose: () => undefined,
          prompt,
          authenticate: () => Promise.resolve(),
          cancel: () => Promise.resolve(),
          close: () => Promise.resolve(),
        });
      },
    };
    const manager = new SessionManager(
      db,
      {} as WorkspaceManager,
      providerRegistry,
      { publish() {} },
      noopLogger,
      runtime,
    );
    const input = async (text: string) => {
      await manager.startInput('session-1', text);
      await manager.waitForSessionOperations('session-1');
    };
    try {
      await manager.startSession('session-1', cwd, 'source', []);
      await input('Original task');
      await manager.updateSessionConfig('session-1', {
        selectedProvider: 'target',
        selectedModel: 'default',
      });
      expect(executions[0]!.prompt).toHaveBeenCalledTimes(1);
      expect(executions[1]!.prompt).not.toHaveBeenCalled();
      await input('Work with target');
      const targetContext = executions[1]!.prompt.mock.calls[0]![2] as string;
      expect(targetContext).toContain('Original task');
      expect(targetContext).toContain('Answer to Original task');
      expect(targetContext).not.toContain('Work with target');
      await manager.updateSessionConfig('session-1', {
        selectedProvider: 'source',
        selectedModel: 'default',
      });
      expect(executions[2]!.options.intent).toEqual({
        kind: 'resume',
        sessionId: 'source-native-1',
      });
      await input('Back to source');
      const returnContext = executions[2]!.prompt.mock.calls[0]![2] as string;
      expect(returnContext).toContain('Work with target');
      expect(returnContext).toContain('Answer to Work with target');
      expect(returnContext).not.toContain('Original task');
      expect(returnContext).not.toContain('Back to source');
      await input('Continue source');
      expect(executions[2]!.prompt.mock.calls[1]![2] ?? '').not.toContain('Work with target');
      await manager.stopSessionAndWait('session-1');
      await manager.reconnectSession('session-1');
      await input('After reconnect');
      expect(executions.at(-1)!.options.intent?.kind).toBe('resume');
      expect(executions.at(-1)!.prompt.mock.calls[0]![2] ?? '').not.toContain('Work with target');
      await manager.updateSessionConfig('session-1', {
        selectedProvider: 'target',
        selectedModel: 'default',
      });
      await input('More target work');
      reportFullContext = true;
      await manager.updateSessionConfig('session-1', {
        selectedProvider: 'source',
        selectedModel: 'default',
      });
      const fullNative = executions.at(-1)!;
      await input('Continue with full provider');
      expect(fullNative.options.intent?.kind).toBe('resume');
      expect(fullNative.prompt).not.toHaveBeenCalled();
      expect(executions.at(-1)!.options.intent?.kind).toBe('new');
      expect(executions.at(-1)!.prompt.mock.calls[0]![2]).toContain('Original task');
      expect(executions.at(-1)!.prompt.mock.calls[0]![2]).toContain('More target work');
      const fullInput = db
        .select()
        .from(sessionEvents)
        .all()
        .filter(
          (event) =>
            event.type === 'text' &&
            JSON.parse(event.data).role === 'user' &&
            JSON.parse(event.data).content === 'Continue with full provider',
        );
      expect(fullInput).toHaveLength(1);
      db.update(sessionProviderContexts)
        .set({ status: 'pending' })
        .where(eq(sessionProviderContexts.providerId, 'source'))
        .run();
      await manager.stopSessionAndWait('session-1');
      await manager.reconnectSession('session-1');
      expect(executions.at(-1)!.options.intent?.kind).toBe('new');
      await input('Recover uncertain delivery');
      expect(executions.at(-1)!.prompt.mock.calls[0]![2]).toContain('Original task');
      await input('Before queued target');
      await manager.updateSessionConfig('session-1', {
        selectedProvider: 'target',
        selectedModel: 'default',
      });
      await manager.waitForSessionOperations('session-1');
      await manager.updateSessionConfig('session-1', {
        selectedProvider: 'source',
        selectedModel: 'default',
      });
      await input('Return after queued target');
      const queuedContext = executions.at(-1)!.prompt.mock.calls[0]![2];
      expect(queuedContext).toContain('Queued target request');
      expect(queuedContext).toContain('Answer to Queued target request');
      const rows = await db.select().from(sessions);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: 'session-1',
        selectedProvider: 'source',
        worktreePath: cwd,
      });
    } finally {
      await manager.stopAll();
      vi.unstubAllEnvs();
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
