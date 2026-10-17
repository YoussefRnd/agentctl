/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { describe, it, expect, vi } from 'vitest';
import { PersistentAgentConnectionManager } from '../acp/transport/persistent-connection.js';
import type { AgentSessionCallbacks } from '../agent/types.js';

describe('PersistentAgentConnectionManager Process Exit', () => {
  it('shares one in-flight connection creation between concurrent callers', async () => {
    const store = { get: vi.fn().mockReturnValue({ id: 'provider-1' }) };
    const fetcher = {
      getSnapshot: vi.fn().mockReturnValue({
        data: JSON.stringify({
          version: '1',
          agents: [
            {
              id: 'provider-1',
              name: 'Provider 1',
              version: '1.0.0',
              description: 'test',
              authors: [],
              distribution: { npx: { package: 'provider-1' } },
            },
          ],
        }),
      }),
    };
    const launcher = {
      resolveLaunch: vi.fn().mockReturnValue({ command: 'provider-1', args: [], env: {} }),
    };
    const mgr = new PersistentAgentConnectionManager(store as any, fetcher as any, launcher as any);
    const expected = { transport: { isAlive: true } };
    let resolveConnection!: (connection: unknown) => void;
    const creation = new Promise((resolve) => {
      resolveConnection = resolve;
    });
    const createSpy = vi.spyOn(mgr as any, 'createPersistentConnection').mockReturnValue(creation);

    const first = mgr.getConnection('provider-1');
    const second = mgr.getConnection('provider-1');
    resolveConnection(expected);

    expect(await first).toBe(expected);
    expect(await second).toBe(expected);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale connection close its replacement', () => {
    const mgr = new PersistentAgentConnectionManager({} as any, {} as any, {} as any);
    const stale = {
      transport: { kill: vi.fn(), isAlive: true },
      terminalManager: { dispose: vi.fn().mockResolvedValue(undefined) },
      idleTimer: null,
    };
    const current = {
      transport: { kill: vi.fn(), isAlive: true },
      terminalManager: { dispose: vi.fn().mockResolvedValue(undefined) },
      idleTimer: null,
    };
    (mgr as any).connections.set('provider-1', current);

    (mgr as any).closeConnectionIfCurrent('provider-1', stale);

    expect((mgr as any).connections.get('provider-1')).toBe(current);
    expect(stale.transport.kill).not.toHaveBeenCalled();
    expect(current.transport.kill).not.toHaveBeenCalled();
  });

  it('only notifies sessions owned by the exiting connection', async () => {
    const mgr = new PersistentAgentConnectionManager({} as any, {} as any, {} as any);
    const ownedUpdate = vi.fn().mockResolvedValue(undefined);
    const unrelatedUpdate = vi.fn().mockResolvedValue(undefined);
    const owned = {
      acpSessionId: 'owned',
      callbacks: { onUpdate: ownedUpdate },
    };
    const unrelated = {
      acpSessionId: 'unrelated',
      callbacks: { onUpdate: unrelatedUpdate },
    };
    const exiting = {
      generation: 1,
      connection: { close: vi.fn() },
      sessions: new Map([['owned', { sessionId: 'owned', createdAt: Date.now() }]]),
      activeSessions: new Map([['owned', owned]]),
      terminalToSession: new Map(),
      transport: { kill: vi.fn(), isAlive: true },
      terminalManager: { dispose: vi.fn().mockResolvedValue(undefined), release: vi.fn() },
      idleTimer: null,
    };
    (mgr as any).connections.set('provider-1', exiting);
    const other = { activeSessions: new Map([['unrelated', unrelated]]) };
    (mgr as any).connections.set('provider-2', other);

    (mgr as any).handleConnectionExit('provider-1', exiting, 1, null);
    await Promise.resolve();

    expect(ownedUpdate).toHaveBeenCalledOnce();
    expect(exiting.connection.close).toHaveBeenCalledOnce();
    expect(unrelatedUpdate).not.toHaveBeenCalled();
    expect(exiting.activeSessions.has('owned')).toBe(false);
    expect(other.activeSessions.has('unrelated')).toBe(true);
  });

  it('unregisters active session and releases terminals cleanly', () => {
    const mockSession = {
      acpSessionId: 'sess-2',
      localSessionId: 'local-2',
      options: {} as any,
      callbacks: {
        onUpdate: vi.fn(),
        onRequestPermission: vi.fn(),
      },
    };

    const mgr = new PersistentAgentConnectionManager({} as any, {} as any, {} as any);

    const mockTerminalManager = {
      dispose: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };

    const mockConn = {
      connection: {},
      sessions: new Map([['sess-2', { sessionId: 'sess-2', createdAt: Date.now() }]]),
      activeSessions: new Map(),
      terminalToSession: new Map([['term-123', 'sess-2']]),
      terminalManager: mockTerminalManager,
      transport: { kill: vi.fn(), isAlive: true },
      idleTimer: null,
    };

    (mgr as any).connections.set('provider-2', mockConn);
    mgr.registerActiveSession('sess-2', mockSession, 'provider-2', mockConn as any);

    mgr.unregisterActiveSession('sess-2', 'provider-2', mockConn as any);

    expect(mockConn.activeSessions.has('sess-2')).toBe(false);
    expect(mockConn.terminalToSession.has('term-123')).toBe(false);
    expect(mockTerminalManager.release).toHaveBeenCalledWith('term-123');
    expect(mockConn.sessions.has('sess-2')).toBe(false);
  });

  it('isolates identical native session IDs across providers and replacement connections', async () => {
    const mgr = new PersistentAgentConnectionManager({} as any, {} as any, {} as any);
    const makeConnection = () => ({
      generation: 1,
      connection: {},
      sessions: new Map(),
      activeSessions: new Map(),
      terminalToSession: new Map(),
      transport: { kill: vi.fn(), isAlive: true },
      terminalManager: { dispose: vi.fn().mockResolvedValue(undefined), release: vi.fn() },
      idleTimer: null,
    });
    const first = makeConnection();
    const second = makeConnection();
    (mgr as any).connections.set('first', first);
    (mgr as any).connections.set('second', second);
    const session = (onUpdate: AgentSessionCallbacks['onUpdate']) => ({
      acpSessionId: 'same',
      localSessionId: 'local',
      options: {} as any,
      callbacks: { onUpdate, onRequestPermission: async () => ({ allowed: false }) },
    });
    const firstUpdate = vi.fn();
    const secondUpdate = vi.fn();
    mgr.registerActiveSession('same', session(firstUpdate), 'first', first as any);
    mgr.registerActiveSession('same', session(secondUpdate), 'second', second as any);
    mgr.unregisterActiveSession('same', 'first', first as any);
    expect(second.activeSessions.get('same')?.callbacks.onUpdate).toBe(secondUpdate);
    expect(second.sessions.has('same')).toBe(true);

    mgr.registerActiveSession('same', session(firstUpdate), 'first', first as any);
    const replacement = makeConnection();
    (mgr as any).connections.set('first', replacement);
    const replacementUpdate = vi.fn();
    mgr.registerActiveSession('same', session(replacementUpdate), 'first', replacement as any);
    (mgr as any).handleConnectionExit('first', first, 1, null);
    await Promise.resolve();
    expect(firstUpdate).toHaveBeenCalledOnce();
    expect(secondUpdate).not.toHaveBeenCalled();
    expect(replacementUpdate).not.toHaveBeenCalled();
    expect(replacement.activeSessions.has('same')).toBe(true);
    expect(second.activeSessions.has('same')).toBe(true);
    expect(replacement.transport.kill).not.toHaveBeenCalled();
  });
  it('final shutdown awaits terminal and process cleanup and rejects new connections', async () => {
    const manager = new PersistentAgentConnectionManager({} as any, {} as any, {} as any);
    let terminalsClosed!: () => void;
    let processClosed!: () => void;
    const terminals = new Promise<void>((resolve) => {
      terminalsClosed = resolve;
    });
    const exited = new Promise<void>((resolve) => {
      processClosed = resolve;
    });
    const connection = {
      idleTimer: null,
      connection: { close: vi.fn() },
      transport: { kill: vi.fn(), closed: exited },
      terminalManager: { dispose: vi.fn(() => terminals) },
    };
    (manager as any).connections.set('provider', connection);
    let finished = false;
    const disposal = manager.dispose().then(() => {
      finished = true;
    });
    await expect(manager.getConnection('provider')).rejects.toThrow('disposed');
    expect(connection.transport.kill).toHaveBeenCalledOnce();
    terminalsClosed();
    await Promise.resolve();
    expect(finished).toBe(false);
    processClosed();
    await disposal;
    expect(finished).toBe(true);
  });
});
