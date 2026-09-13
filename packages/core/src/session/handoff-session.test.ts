import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../db/index.js';
import { projects, sessionEvents, sessions } from '../db/schema.js';
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
  it('invokes the source skill, keeps the workspace, and prompts a fresh target', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-handoff-session-'));
    const agentctlHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-handoff-home-'));
    const originalAgentctlHome = process.env.AGENTCTL_HOME;
    const originalSkillsDirectory = process.env.AGENTCTL_SKILLS_DIR;
    const originalSkillPath = process.env.AGENTCTL_SKILL_PATH;
    const originalWorkspaceSkillsDirectory = process.env.AGENTCTL_WORKSPACE_SKILLS_DIR;
    process.env.AGENTCTL_HOME = agentctlHome;
    process.env.AGENTCTL_SKILLS_DIR = path.join(agentctlHome, 'skills');
    delete process.env.AGENTCTL_SKILL_PATH;
    delete process.env.AGENTCTL_WORKSPACE_SKILLS_DIR;
    const db = createDatabase(':memory:');
    await db.insert(projects).values({
      id: 'project-1',
      name: 'project',
      path: cwd,
    });
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
      selectedThinkingEffort: 'medium',
      baseCommit: 'none',
      mode: 'local',
    });
    await db.insert(sessionEvents).values({
      sessionId: 'session-1',
      type: 'text',
      data: JSON.stringify({ role: 'user', content: 'Keep this context' }),
    });

    const providers = new Map([
      ['source', createProvider('source')],
      ['target', createProvider('target')],
    ]);
    const providerRegistry = {
      ensureProviderReady: (providerId: string) => Promise.resolve(providers.get(providerId)!),
      getSettings: () => Promise.resolve({ defaultProviderId: 'source' }),
      discover: () => Promise.resolve(Array.from(providers.values()).map((p) => p.toDiscovery())),
    } as unknown as ProviderRegistry;

    const executions: {
      options: AgentSessionOptions;
      prompt: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
    }[] = [];
    const runtime: AgentDriver = {
      inspectProvider: () =>
        Promise.resolve({
          status: 'ready',
          configOptions: [],
          authMethods: [],
          supportsDynamicModel: false,
          supportsDynamicConfig: false,
        }),
      startSession: (_command, _args, options, callbacks) => {
        const prompt = vi.fn(async () => {
          if (options.providerId === 'source') {
            const filePath = path.join(os.tmpdir(), `source-handoff-${Date.now()}.md`);
            await fs.writeFile(filePath, '# Skill handoff\n\nKeep this context\n');
            await callbacks.onUpdate({ type: 'text', text: `Wrote handoff to \`${filePath}\`` });
          }
          return { stopReason: 'end_turn' as const };
        });
        const stop = vi.fn(() => Promise.resolve());
        executions.push({ options, prompt, stop });
        return Promise.resolve({
          id: `${options.providerId}-acp-session`,
          history: 'fresh',
          closed: new Promise<void>(() => undefined),
          onError: () => undefined,
          onClose: () => undefined,
          prompt,
          authenticate: () => Promise.resolve(),
          cancel: () => Promise.resolve(),
          close: stop,
        });
      },
    };

    const manager = new SessionManager(
      db,
      {} as WorkspaceManager,
      providerRegistry,
      { publish: () => undefined },
      noopLogger,
      runtime,
    );
    await manager.startSession('session-1', cwd, 'source', []);

    const result = await manager.handoffSession('session-1', 'target');

    expect(result).toMatchObject({
      sessionId: 'session-1',
      handoffSource: 'skill',
    });
    expect(executions).toHaveLength(2);
    expect(executions[0]?.prompt).toHaveBeenCalledWith(
      'Continue this work with target.',
      [],
      expect.stringContaining('name: handoff'),
    );
    expect(executions[0]?.stop).toHaveBeenCalledOnce();
    expect(executions[1]?.options).toMatchObject({
      providerId: 'target',
      localSessionId: 'session-1',
      cwd,
      intent: { kind: 'new' },
    });
    expect(executions[1]?.prompt).toHaveBeenCalledWith(
      expect.stringContaining('Continue the work'),
      [],
      expect.stringContaining('Keep this context'),
    );

    const storedSessions = await db.select().from(sessions);
    expect(storedSessions).toHaveLength(1);
    expect(storedSessions[0]).toMatchObject({
      id: 'session-1',
      selectedProvider: 'target',
      worktreePath: cwd,
    });

    await fs.unlink(result.handoffFilePath).catch(() => undefined);
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.rm(agentctlHome, { recursive: true, force: true });
    if (originalAgentctlHome === undefined) {
      delete process.env.AGENTCTL_HOME;
    } else {
      process.env.AGENTCTL_HOME = originalAgentctlHome;
    }
    if (originalSkillsDirectory === undefined) {
      delete process.env.AGENTCTL_SKILLS_DIR;
    } else {
      process.env.AGENTCTL_SKILLS_DIR = originalSkillsDirectory;
    }
    if (originalSkillPath === undefined) {
      delete process.env.AGENTCTL_SKILL_PATH;
    } else {
      process.env.AGENTCTL_SKILL_PATH = originalSkillPath;
    }
    if (originalWorkspaceSkillsDirectory === undefined) {
      delete process.env.AGENTCTL_WORKSPACE_SKILLS_DIR;
    } else {
      process.env.AGENTCTL_WORKSPACE_SKILLS_DIR = originalWorkspaceSkillsDirectory;
    }
  });
});
