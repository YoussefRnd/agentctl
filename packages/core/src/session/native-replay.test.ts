import { composeRepositoryResources } from './composition/repository-resources.js';
import { expect, test, vi } from 'vite-plus/test';
import { createDatabase, projects, sessions, sessionEvents } from '../db/index.js';
import type { AgentDriver, AgentSession } from '../agent/types.js';
import type { WorkspaceManager } from '../git/worktree-manager.js';
import type { ProviderRegistry } from '../providers/provider-registry.js';
import { noopLogger } from '../logger.js';
import { SessionEventRepository } from './persistence/session-event-repository.js';
import { SessionRuntimeRegistry } from './runtime/session-runtime-registry.js';
import { EMPTY_AGENT_FEATURES } from '@agentctl/shared';

test('native replay persists startup history with user roles, complete chunks, and turn parents', async () => {
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'project', name: 'Project', path: '/tmp' }).run();
  db.insert(sessions)
    .values({
      id: 'session',
      projectId: 'project',
      agent: 'provider',
      selectedProvider: 'provider',
      worktreePath: '/tmp',
      branch: 'main',
      baseCommit: 'none',
      taskSlug: 'import',
    })
    .run();
  let liveCallbacks: Parameters<AgentDriver['startSession']>[3] | undefined;
  const nativePrompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });
  const runtime: AgentDriver = {
    inspectProvider: vi.fn(),
    startSession: async (_command, _args, options, callbacks) => {
      expect(options.intent).toMatchObject({
        kind: 'resume',
        sessionId: 'native-id',
        requireExisting: true,
      });
      liveCallbacks = callbacks;
      await callbacks.onUpdate({ type: 'user_text', text: 'Original ', messageId: 'u1' });
      await callbacks.onUpdate({ type: 'user_text', text: 'request', messageId: 'u1' });
      await callbacks.onUpdate({ type: 'text', text: 'First reply', messageId: 'a1' });
      await callbacks.onUpdate({ type: 'user_text', text: 'Follow-up', messageId: 'u2' });
      await callbacks.onUpdate({ type: 'text', text: 'Second reply', messageId: 'a2' });
      return {
        id: 'native-id',
        history: 'restored',
        closed: new Promise<void>(() => {}),
        onClose() {},
        onError() {},
        prompt: nativePrompt,
        close: vi.fn().mockResolvedValue(undefined),
        cancel: vi.fn(),
        authenticate: vi.fn(),
      } as AgentSession;
    },
  };
  const machine = new SessionRuntimeRegistry(
    db,
    {} as ProviderRegistry,
    new SessionEventRepository(db, { publish() {} }),
    noopLogger,
    runtime,
    composeRepositoryResources({} as WorkspaceManager),
  );
  const loaded = await machine.startSession(
    'session',
    '/tmp',
    'agent',
    [],
    {},
    'default',
    'medium',
    EMPTY_AGENT_FEATURES,
    undefined,
    { kind: 'resume', sessionId: 'native-id', requireExisting: true },
  );
  await loaded.flushAll();
  const rows = db
    .select()
    .from(sessionEvents)
    .all()
    .filter((row) => row.type === 'text');
  expect(rows.map((row) => JSON.parse(row.data))).toEqual([
    { role: 'user', content: 'Original request', messageId: 'u1' },
    { role: 'provider', content: 'First reply', messageId: 'a1' },
    { role: 'user', content: 'Follow-up', messageId: 'u2' },
    { role: 'provider', content: 'Second reply', messageId: 'a2' },
  ]);
  expect(rows[1].parentEventId).toBe(rows[0].id);
  expect(rows[3].parentEventId).toBe(rows[2].id);
  expect(loaded.requiresHistoryContext).toBe(false);
  await loaded.prompt('Continue imported work');
  expect(nativePrompt.mock.lastCall?.[2] ?? '').not.toContain('Original request');
  const receipt = db.query.sessionProviderContexts.findFirst();
  expect((await receipt)?.status).toBe('delivered');
  await liveCallbacks!.onUpdate({ type: 'user_text', text: 'echo should be ignored' });
  expect(
    db
      .select()
      .from(sessionEvents)
      .all()
      .filter((row) => row.type === 'text'),
  ).toHaveLength(5);
  await machine.stopSessionAndWait('session');
});
