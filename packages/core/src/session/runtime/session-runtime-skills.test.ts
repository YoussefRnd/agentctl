import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, projects, sessions, sessionSkillCatalogs } from '../../db/index.js';
import type { AgentDriver, AgentSession } from '../../agent/types.js';
import type { WorkspaceManager } from '../../git/worktree-manager.js';
import type { ProviderRegistry } from '../../providers/provider-registry.js';
import { noopLogger } from '../../logger.js';
import { createCompactionProjector } from '../../acp/protocol/compaction.js';
import { SessionEventRepository } from '../persistence/session-event-repository.js';
import { SessionRuntime } from './session-runtime.js';
import { SessionRuntimeRegistry } from './session-runtime-registry.js';

let home: string;
let db: ReturnType<typeof createDatabase>;
let events: SessionEventRepository;
let runtimes: SessionRuntime[];

async function writeSkill(
  description = 'Example skill.',
  content = 'Follow these example instructions.',
) {
  const directory = path.join(home, 'skills', 'example');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'SKILL.md'),
    `---\nname: example\ndescription: ${description}\n---\n\n${content}\n`,
  );
}

function handle(id = 'native', history: AgentSession['history'] = 'fresh'): AgentSession {
  return {
    id,
    history,
    closed: new Promise<void>(() => {}),
    onError() {},
    onClose() {},
    prompt: vi.fn<AgentSession['prompt']>().mockResolvedValue({ stopReason: 'end_turn' }),
    authenticate: async () => {},
    cancel: async () => {},
    close: async () => {},
  };
}

function runtime(agent = handle(), sessionId = 'session') {
  const session = new SessionRuntime(sessionId, agent, db, events, home);
  runtimes.push(session);
  return { session, prompt: vi.mocked(agent.prompt) };
}

async function compact(session: SessionRuntime, id: string, status = 'completed') {
  for (const event of createCompactionProjector()({
    sessionUpdate: 'compaction_update',
    compactionId: id,
    status,
  })) {
    await session.handleDomainEvent(event);
  }
}

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-skill-delivery-'));
  vi.stubEnv('AGENTCTL_HOME', home);
  vi.stubEnv('AGENTCTL_SKILLS_DIR', path.join(home, 'skills'));
  vi.stubEnv('AGENTCTL_SKILL_PATH', '');
  vi.stubEnv('AGENTCTL_WORKSPACE_SKILLS_DIR', path.join(home, 'workspace-skills'));
  await writeSkill();
  db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'project', name: 'Project', path: home }).run();
  db.insert(sessions)
    .values({
      id: 'session',
      projectId: 'project',
      agent: 'provider',
      selectedProvider: 'provider',
      worktreePath: home,
      branch: 'main',
      baseCommit: 'none',
      taskSlug: 'skills',
      title: 'Skills',
    })
    .run();
  events = new SessionEventRepository(db, { publish() {} });
  runtimes = [];
});

afterEach(async () => {
  await Promise.all(runtimes.map((session) => session.stop()));
  vi.unstubAllEnvs();
  await fs.rm(home, { recursive: true, force: true });
});

describe('skill catalog delivery', () => {
  it('sends the catalog once while preserving per-message context and explicit activations', async () => {
    const { session, prompt } = runtime();
    await session.prompt('First', undefined, 'Historical context');
    expect(prompt.mock.calls[0][2]).toContain('Historical context');
    expect(prompt.mock.calls[0][2]).toContain('## Available Agent Skills');
    await session.prompt('Second');
    expect(prompt.mock.calls[1][2]).toBeUndefined();
    await session.prompt('/example');
    await session.prompt('/example');
    for (const call of prompt.mock.calls.slice(2)) {
      expect(call[2]).toContain('### Activated Skill: example');
      expect(call[2]).toContain('Follow these example instructions.');
      expect(call[2]).not.toContain('## Available Agent Skills');
    }
    await writeSkill('Example skill.', 'Updated activation instructions.');
    await session.prompt('Use example', undefined, undefined, { name: 'example' });
    expect(prompt.mock.lastCall?.[2]).toContain('Updated activation instructions.');
    expect(prompt.mock.lastCall?.[2]).not.toContain('## Available Agent Skills');
  });

  it('keeps the receipt across a restored runtime but resets it for a fresh conversation', async () => {
    const first = runtime();
    await first.session.prompt('First');
    await first.session.stop();
    const restored = runtime(handle('native', 'restored'));
    await restored.session.prompt('After reconnect');
    expect(restored.prompt.mock.lastCall?.[2]).toBeUndefined();
    await restored.session.stop();
    const fresh = runtime(handle('native', 'fresh'));
    await fresh.session.prompt('Fresh conversation with a reused ID');
    expect(fresh.prompt.mock.lastCall?.[2]).toContain('## Available Agent Skills');
  });

  it('does not share receipts between native IDs, providers, or local sessions', async () => {
    await runtime().session.prompt('First');
    const otherNative = runtime(handle('other-native', 'restored'));
    await otherNative.session.prompt('Different native session');
    expect(otherNative.prompt.mock.lastCall?.[2]).toContain('## Available Agent Skills');
    db.update(sessions).set({ selectedProvider: 'other-provider' }).run();
    const otherProvider = runtime(handle('native', 'restored'));
    await otherProvider.session.prompt('Different provider');
    expect(otherProvider.prompt.mock.lastCall?.[2]).toContain('## Available Agent Skills');
    db.insert(sessions)
      .values({
        id: 'other-session',
        projectId: 'project',
        agent: 'other-provider',
        selectedProvider: 'other-provider',
        worktreePath: home,
        branch: 'main',
        baseCommit: 'none',
        taskSlug: 'other',
        title: 'Other',
      })
      .run();
    const otherLocal = runtime(handle('native', 'restored'), 'other-session');
    await otherLocal.session.prompt('Different local session');
    expect(otherLocal.prompt.mock.lastCall?.[2]).toContain('## Available Agent Skills');
  });

  it('resends a changed catalog once, including skill removals', async () => {
    const { session, prompt } = runtime();
    await session.prompt('First');
    await writeSkill('Changed description.');
    await session.prompt('After catalog edit');
    expect(prompt.mock.lastCall?.[2]).toContain('Changed description.');
    await session.prompt('Unchanged');
    expect(prompt.mock.lastCall?.[2]).toBeUndefined();
    await fs.rm(path.join(home, 'skills', 'example'), { recursive: true });
    await session.prompt('After removal');
    expect(prompt.mock.lastCall?.[2]).toContain('## Available Agent Skills');
    expect(prompt.mock.lastCall?.[2]).not.toContain('example');
    await fs.rm(path.join(home, 'skills'), { recursive: true });
    await session.prompt('After removing all skills');
    expect(prompt.mock.lastCall?.[2]).toContain('No AgentCtl skills are currently available.');
    await session.prompt('Still empty');
    expect(prompt.mock.lastCall?.[2]).toBeUndefined();
  });

  it('invalidates after completed compaction, preserving receipts on failed or duplicate notifications', async () => {
    const { session, prompt } = runtime();
    await session.prompt('First');
    await compact(session, 'failed', 'failed');
    await compact(session, 'pending', 'in_progress');
    await session.prompt('Still retained');
    expect(prompt.mock.lastCall?.[2]).toBeUndefined();
    await compact(session, 'complete');
    await session.prompt('After compaction');
    expect(prompt.mock.lastCall?.[2]).toContain('## Available Agent Skills');
    await compact(session, 'complete');
    await session.prompt('Duplicate completion');
    expect(prompt.mock.lastCall?.[2]).toBeUndefined();
  });

  it('does not acknowledge a catalog discarded by compaction during the prompt', async () => {
    const { session, prompt } = runtime();
    prompt.mockImplementationOnce(async () => {
      await compact(session, 'during-prompt');
      return { stopReason: 'end_turn' };
    });
    await session.prompt('First');
    await session.prompt('After compaction');
    expect(prompt.mock.lastCall?.[2]).toContain('## Available Agent Skills');
    await session.prompt('Retained');
    expect(prompt.mock.lastCall?.[2]).toBeUndefined();
  });

  it('does not record rejected delivery but retains accepted foreground failures', async () => {
    const rejected = runtime();
    rejected.prompt.mockRejectedValueOnce(new Error('Rejected'));
    await expect(rejected.session.prompt('First')).rejects.toThrow('Rejected');
    expect(db.select().from(sessionSkillCatalogs).all()).toEqual([]);
    const restored = runtime(handle('native', 'restored'));
    restored.prompt.mockResolvedValueOnce({
      stopReason: 'error',
      userMessageId: 'accepted',
      error: { code: -1, message: 'Quota' },
    });
    await restored.session.prompt('Retry');
    expect(restored.prompt.mock.lastCall?.[2]).toContain('## Available Agent Skills');
    await restored.session.prompt('Next');
    expect(restored.prompt.mock.lastCall?.[2]).toBeUndefined();
  });

  it('reconciles the latest replayed compaction on resume without invalidating for older replay', async () => {
    const initial = runtime();
    await initial.session.prompt('First');
    await compact(initial.session, 'c2');
    await initial.session.prompt('After c2');
    await initial.session.stop();
    let replay = ['c1', 'c2'];
    let agent = handle('native', 'restored');
    const driver = {
      inspectProvider: vi.fn(),
      startSession: async (_command, _args, _options, callbacks) => {
        for (const compactionId of replay)
          await callbacks.onUpdate({ type: 'context_compacted', compactionId });
        return agent;
      },
    } satisfies AgentDriver;
    const machine = new SessionRuntimeRegistry(
      db,
      {} as WorkspaceManager,
      {} as ProviderRegistry,
      events,
      noopLogger,
      driver,
    );
    const resume = () =>
      machine.startSession(
        'session',
        home,
        'agent',
        [],
        {},
        'default',
        null,
        undefined,
        undefined,
        { kind: 'resume', sessionId: 'native' },
      );
    const resumed = await resume();
    runtimes.push(resumed);
    await resumed.prompt('Reconnect');
    expect(vi.mocked(agent.prompt).mock.lastCall?.[2]).toBeUndefined();
    await machine.stopSessionAndWait('session');
    replay = ['c1', 'c2', 'c3'];
    agent = handle('native', 'restored');
    const compacted = await resume();
    runtimes.push(compacted);
    await compacted.prompt('New compaction while disconnected');
    expect(vi.mocked(agent.prompt).mock.lastCall?.[2]).toContain('## Available Agent Skills');
    await machine.stopSessionAndWait('session');
  });
});
