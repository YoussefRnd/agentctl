import { expect, test, vi } from 'vite-plus/test';
import { ACP_SESSION_CLOSE_TIMEOUT_MS } from './limits.js';
import {
  PersistentAgentConnectionManager,
  type PersistentConnection,
} from './persistent-connection.js';

test('an unresponsive session close releases local ownership without killing another session', async () => {
  const manager = new PersistentAgentConnectionManager({} as never, {} as never, {} as never);
  const connection = {
    connection: { closeSession: vi.fn(() => new Promise<never>(() => {})) },
    capabilities: { supportsCloseSession: true },
    sessions: new Map([
      ['closed', { sessionId: 'closed', createdAt: 0 }],
      ['sibling', { sessionId: 'sibling', createdAt: 0 }],
    ]),
    activeSessions: new Map([
      ['closed', {}],
      ['sibling', {}],
    ]),
    terminalToSession: new Map([['terminal', 'closed']]),
    terminalManager: { release: vi.fn() },
    transport: { kill: vi.fn() },
  };
  const internals = manager as unknown as { connections: Map<string, PersistentConnection> };
  internals.connections.set('provider', connection as unknown as PersistentConnection);
  vi.useFakeTimers();
  try {
    const closing = manager.closeSession(
      'provider',
      'closed',
      connection as unknown as PersistentConnection,
    );
    expect(connection.sessions.has('closed')).toBe(false);
    expect(connection.activeSessions.has('closed')).toBe(false);
    expect(connection.terminalManager.release).toHaveBeenCalledWith('terminal');
    await vi.advanceTimersByTimeAsync(ACP_SESSION_CLOSE_TIMEOUT_MS + 1);
    await closing;
    expect(connection.sessions.has('sibling')).toBe(true);
    expect(connection.activeSessions.has('sibling')).toBe(true);
    expect(connection.transport.kill).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
