/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { describe, it, expect, vi } from 'vitest';
import { PersistentAgentConnectionManager } from './registry/persistent-connection.js';

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
      transport: { kill: vi.fn() },
      terminalManager: { dispose: vi.fn().mockResolvedValue(undefined) },
      idleTimer: null,
    };
    const current = {
      transport: { kill: vi.fn() },
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
    (mgr as any).activeSessions.set('owned', {
      acpSessionId: 'owned',
      callbacks: { onUpdate: ownedUpdate },
    });
    (mgr as any).activeSessions.set('unrelated', {
      acpSessionId: 'unrelated',
      callbacks: { onUpdate: unrelatedUpdate },
    });
    const exiting = {
      generation: 1,
      sessions: new Map([['owned', { sessionId: 'owned', createdAt: Date.now() }]]),
      transport: { kill: vi.fn() },
      terminalManager: { dispose: vi.fn().mockResolvedValue(undefined), release: vi.fn() },
      idleTimer: null,
    };
    (mgr as any).connections.set('provider-1', exiting);

    (mgr as any).handleConnectionExit('provider-1', exiting, 1, null);
    await Promise.resolve();

    expect(ownedUpdate).toHaveBeenCalledOnce();
    expect(unrelatedUpdate).not.toHaveBeenCalled();
    expect((mgr as any).activeSessions.has('owned')).toBe(false);
    expect((mgr as any).activeSessions.has('unrelated')).toBe(true);
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
    mgr.registerActiveSession('sess-2', mockSession, 'provider-2');

    const mockTerminalManager = {
      dispose: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };

    const mockConn = {
      sessions: new Map([['sess-2', { sessionId: 'sess-2', createdAt: Date.now() }]]),
      terminalManager: mockTerminalManager,
      transport: { kill: vi.fn() },
      idleTimer: null,
    };

    (mgr as any).connections.set('provider-2', mockConn);
    (mgr as any).terminalToSession.set('term-123', 'sess-2');

    mgr.unregisterActiveSession('sess-2');

    expect((mgr as any).activeSessions.has('sess-2')).toBe(false);
    expect((mgr as any).terminalToSession.has('term-123')).toBe(false);
    expect(mockTerminalManager.release).toHaveBeenCalledWith('term-123');
    expect(mockConn.sessions.has('sess-2')).toBe(false);
  });
});
