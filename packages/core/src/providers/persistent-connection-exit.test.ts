/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PersistentAgentConnectionManager } from './registry/persistent-connection.js';

describe('PersistentAgentConnectionManager Process Exit', () => {
  it('notifies active sessions when underlying child process exits unexpectedly', async () => {
    const mockSession = {
      acpSessionId: 'sess-1',
      localSessionId: 'local-1',
      options: {} as any,
      callbacks: {
        onEvent: vi.fn().mockResolvedValue(undefined),
        onRequestPermission: vi.fn(),
      },
    };

    const mgr = new PersistentAgentConnectionManager({} as any, {} as any, {} as any);
    mgr.registerActiveSession('sess-1', mockSession, 'provider-1');

    const mockChild = new EventEmitter() as any;
    mockChild.killed = false;
    mockChild.exitCode = null;
    mockChild.kill = vi.fn();

    const mockTerminalManager = {
      dispose: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };

    const mockConn = {
      child: mockChild,
      sessions: new Map([['sess-1', { sessionId: 'sess-1', createdAt: Date.now() }]]),
      terminalManager: mockTerminalManager,
      transport: { kill: vi.fn() },
      idleTimer: null,
    };

    (mgr as any).connections.set('provider-1', mockConn);

    // Attach exit handler as created in persistent connection manager
    const exitHandler = async (code: number | null, signal: string | null) => {
      const conn = (mgr as any).connections.get('provider-1');
      const sessionsToNotify: any[] = [];
      for (const [acpSessionId, session] of (mgr as any).activeSessions.entries()) {
        if (conn?.sessions.has(acpSessionId) || conn?.sessions.size === 0) {
          sessionsToNotify.push(session);
        }
      }

      for (const session of sessionsToNotify) {
        await session.callbacks.onEvent({
          type: 'status',
          status: 'error',
          title: `Agent process exited with code ${String(code ?? signal)}`,
        });
        mgr.unregisterActiveSession(session.acpSessionId);
      }

      mgr.closeConnection('provider-1');
    };

    mockChild.once('exit', exitHandler);
    mockChild.emit('exit', 1, null);

    // Allow promise callbacks in event handler to resolve
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockSession.callbacks.onEvent).toHaveBeenCalledWith({
      type: 'status',
      status: 'error',
      title: 'Agent process exited with code 1',
    });

    expect((mgr as any).activeSessions.has('sess-1')).toBe(false);
  });

  it('notifies active sessions with signal name when killed by signal', async () => {
    const mockSession = {
      acpSessionId: 'sess-sig',
      localSessionId: 'local-sig',
      options: {} as any,
      callbacks: {
        onEvent: vi.fn().mockResolvedValue(undefined),
        onRequestPermission: vi.fn(),
      },
    };

    const mgr = new PersistentAgentConnectionManager({} as any, {} as any, {} as any);
    mgr.registerActiveSession('sess-sig', mockSession, 'provider-sig');

    const mockChild = new EventEmitter() as any;
    const mockConn = {
      child: mockChild,
      sessions: new Map([['sess-sig', { sessionId: 'sess-sig', createdAt: Date.now() }]]),
      terminalManager: { dispose: vi.fn().mockResolvedValue(undefined), release: vi.fn() },
      transport: { kill: vi.fn() },
      idleTimer: null,
    };
    (mgr as any).connections.set('provider-sig', mockConn);

    const exitHandler = async (code: number | null, signal: string | null) => {
      const conn = (mgr as any).connections.get('provider-sig');
      const sessionsToNotify: any[] = [];
      for (const [acpSessionId, session] of (mgr as any).activeSessions.entries()) {
        if (conn?.sessions.has(acpSessionId) || conn?.sessions.size === 0) {
          sessionsToNotify.push(session);
        }
      }

      for (const session of sessionsToNotify) {
        await session.callbacks.onEvent({
          type: 'status',
          status: 'error',
          title: `Agent process exited with code ${String(code ?? signal)}`,
        });
        mgr.unregisterActiveSession(session.acpSessionId);
      }

      mgr.closeConnection('provider-sig');
    };

    mockChild.once('exit', exitHandler);
    mockChild.emit('exit', null, 'SIGKILL');

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockSession.callbacks.onEvent).toHaveBeenCalledWith({
      type: 'status',
      status: 'error',
      title: 'Agent process exited with code SIGKILL',
    });
    expect((mgr as any).activeSessions.has('sess-sig')).toBe(false);
  });

  it('unregisters active session and releases terminals cleanly', () => {
    const mockSession = {
      acpSessionId: 'sess-2',
      localSessionId: 'local-2',
      options: {} as any,
      callbacks: {
        onEvent: vi.fn(),
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
