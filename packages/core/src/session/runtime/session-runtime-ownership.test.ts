import { composeRepositoryResources } from '../composition/repository-resources.js';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { eq } from 'drizzle-orm';
import { createDatabase, projects, sessions, sessionRuntimeBindings } from '../../db/index.js';
import type { AgentDriver, AgentSession } from '../../agent/types.js';
import type { WorkspaceManager } from '../../git/worktree-manager.js';
import type { ProviderRegistry } from '../../providers/provider-registry.js';
import { noopLogger } from '../../logger.js';
import { SessionEventRepository } from '../persistence/session-event-repository.js';
import { SessionRuntime } from './session-runtime.js';
import { SessionRuntimeRegistry } from './session-runtime-registry.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0)) await close();
});
function fixture() {
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'p', name: 'Project', path: '/tmp/project' }).run();
  db.insert(sessions)
    .values({
      id: 's',
      projectId: 'p',
      branch: 'main',
      worktreePath: '/tmp/project',
      taskSlug: 'task',
      baseCommit: 'none',
      agent: 'provider',
      selectedProvider: 'provider',
    })
    .run();
  const events = new SessionEventRepository(db, { publish: vi.fn() });
  const registry = new SessionRuntimeRegistry(
    db,
    {} as ProviderRegistry,
    events,
    noopLogger,
    {} as AgentDriver,
    composeRepositoryResources({} as WorkspaceManager),
  );
  cleanup.push(() => registry.stopAll());
  function bind(availableModes?: string[]) {
    let error!: (error: Error) => void;
    let closed!: Parameters<AgentSession['onClose']>[0];
    const handle = {
      id: 'remote',
      availableModes,
      history: 'fresh',
      closed: new Promise<void>(() => {}),
      onError: (callback: typeof error) => {
        error = callback;
      },
      onClose: (callback: typeof closed) => {
        closed = callback;
      },
      close: vi.fn(async () => {}),
      prompt: vi.fn(async () => ({ stopReason: 'end_turn' as const })),
      authenticate: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      writeTerminalInput: vi.fn(() => true),
    } satisfies Partial<AgentSession>;
    const runtime = new SessionRuntime(
      's',
      handle as AgentSession,
      db,
      events,
      '/tmp/project',
      registry,
    );
    registry.registerSession('s', runtime);
    return {
      runtime,
      handle,
      error: (value: Error) => error(value),
      closed: () => closed({ code: 0, signal: null }),
    };
  }
  return { db, events, registry, bind };
}
const request = {
  id: 'question',
  mode: 'url' as const,
  message: 'Sign in',
  url: { url: 'https://example.com' },
};

test('shutdown releases requests and closes bindings even if flushing and provider close fail', async () => {
  const { db, registry, bind } = fixture();
  const { runtime, handle } = bind();
  await runtime.recordRuntimeBinding();
  const pending = runtime.requestElicitation(request);
  await vi.waitFor(() =>
    expect(runtime.elicitationRegistry.getElicitation('question')).toBeDefined(),
  );
  vi.spyOn(runtime, 'flushAll').mockRejectedValue(new Error('flush failed'));
  handle.close.mockRejectedValue(new Error('close failed'));
  const stopping = runtime.stop();
  expect(runtime.stop()).toBe(stopping);
  expect(await pending).toEqual({ action: 'cancel' });
  await expect(stopping).rejects.toMatchObject({ errors: [expect.any(Error), expect.any(Error)] });
  expect(handle.close).toHaveBeenCalledOnce();
  expect(db.select().from(sessionRuntimeBindings).get()?.connectionState).toBe('closed');
  // Remove the failed owner; cleanup may surface errors but must still detach it.
  await expect(registry.stopSessionAndWait('s')).rejects.toThrow('Failed to stop');
  expect(registry.hasSession('s')).toBe(false);
});

test('replacement revokes old output, permissions, elicitations, terminal input and exit callbacks', async () => {
  const { db, events, registry, bind } = fixture();
  const old = bind();
  const pending = old.runtime.requestElicitation(request);
  const current = bind();
  await pending;
  db.update(sessions).set({ status: 'running' }).where(eq(sessions.id, 's')).run();
  const append = vi.spyOn(events, 'append');
  await old.runtime.handleDomainEvent({ type: 'session_info_update', title: 'stale' });
  await expect(
    old.runtime.handleRequestPermission({
      permissionId: 'approval',
      toolCall: { name: 'read', arguments: {} },
    }),
  ).resolves.toMatchObject({ allowed: false, cancelled: true });
  await expect(old.runtime.requestElicitation(request)).resolves.toEqual({ action: 'cancel' });
  expect(old.runtime.writeTerminalInput('terminal', 'input')).toBe(false);
  old.error(new Error('late exit'));
  old.closed();
  await old.runtime.stop();
  expect(append).not.toHaveBeenCalled();
  expect(db.select().from(sessions).get()?.status).toBe('running');
  expect(current.runtime.isDead).toBe(false);
  expect(registry.ownsRuntime('s', old.runtime.runtimeId)).toBe(false);
  await registry.stopSessionAndWait('s');
  expect(registry.ownsRuntime('s', current.runtime.runtimeId)).toBe(false);
});

test('a runtime transition rechecks ownership after reading the session', async () => {
  const { db, registry, bind } = fixture();
  const old = bind();
  const transition = registry.transitionTo('s', 'error', { runtimeId: old.runtime.runtimeId });
  const current = bind();
  await transition;
  expect(current.runtime.isDead).toBe(false);
  expect(db.select().from(sessions).get()?.status).toBe('idle');
});

test('finishing shutdown of an old owner cannot remove a replacement from the registry', async () => {
  const { registry, bind } = fixture();
  const old = bind();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(old.runtime, 'flushAll').mockReturnValue(gate);
  const stopping = registry.stopAll();
  const current = bind();
  release();
  await stopping;
  expect(registry.getSession('s')).toBe(current.runtime);
  expect(current.runtime.isDead).toBe(false);
});

test('failed elicitation publication releases its waiter', async () => {
  const { events, bind } = fixture();
  const { runtime } = bind();
  vi.spyOn(events, 'append').mockRejectedValueOnce(new Error('store unavailable'));
  await expect(runtime.requestElicitation(request)).rejects.toThrow('store unavailable');
  expect(runtime.elicitationRegistry.getElicitation('question')?.status).toBe('cancelled');
  expect(runtime.respondToElicitation('question', { action: 'cancel' })).toBe(false);
});

test('a provider update suspended in projection cannot overwrite replacement session metrics', async () => {
  const { db, bind } = fixture();
  const old = bind();
  const update = old.runtime.handleDomainEvent({ type: 'usage_update', used: 999, size: 1000 });
  // Enter the projector, then replace the owner while its session read is awaited.
  await Promise.resolve();
  bind();
  await update;
  expect(db.select().from(sessions).get()?.totalTokens).toBe(0);
});

test('runtime binding and initialized personas roll back together on failure', async () => {
  const { db, bind } = fixture();
  const { runtime } = bind(['architect', 'coder']);
  db.run(
    "CREATE TRIGGER reject_personas BEFORE UPDATE OF available_agent_personas ON sessions BEGIN SELECT RAISE(ABORT, 'persona unavailable'); END",
  );
  await expect(runtime.recordRuntimeBinding()).rejects.toThrow('persona unavailable');
  expect(db.select().from(sessionRuntimeBindings).all()).toEqual([]);
  db.run('DROP TRIGGER reject_personas');
  await runtime.recordRuntimeBinding();
  expect(db.select().from(sessionRuntimeBindings).get()?.connectionState).toBe('connected');
  expect(JSON.parse(db.select().from(sessions).get()!.availableAgentPersonas)).toEqual([
    'architect',
    'coder',
  ]);
});
