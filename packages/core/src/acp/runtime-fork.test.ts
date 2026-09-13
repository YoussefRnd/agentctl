import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vitest';
import type { ClientSideConnection } from '@agentclientprotocol/sdk';
import { DefaultAgentRuntime } from './runtime.js';
import { parseAcpCapabilities } from './transport/capabilities-cache.js';
import type { AgentStreamTransport, IConnectionManager } from './types.js';

function setup(supported = true) {
  const closed = new Promise<void>(() => {});
  const connection = {
    closed,
    unstable_forkSession: vi.fn().mockResolvedValue({ sessionId: 'forked-agent-id' }),
    newSession: vi.fn().mockResolvedValue({ sessionId: 'fresh-agent-id' }),
    prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn' }),
  };
  const manager: IConnectionManager = {
    getProviderIdByCommand: () => 'provider',
    getConnection: vi.fn().mockResolvedValue({
      child: new EventEmitter() as ChildProcess,
      transport: { closed, isAlive: true } as AgentStreamTransport,
      connection: connection as unknown as ClientSideConnection,
      capabilities: parseAcpCapabilities({
        sessionCapabilities: { fork: supported ? {} : undefined },
      }),
    }),
    closeSession: vi.fn(),
    registerActiveSession: vi.fn(),
    unregisterActiveSession: vi.fn(),
    writeTerminalInput: () => false,
  };
  const runtime = new DefaultAgentRuntime();
  runtime.setConnectionManager(manager);
  const execute = () =>
    runtime.startSession(
      'agent',
      [],
      {
        providerId: 'provider',
        localSessionId: 'local-fork',
        cwd: '/tmp/destination-worktree',
        intent: { kind: 'fork', sessionId: 'source-agent-id' },
        mcpServers: [],
      },
      { onUpdate() {}, onRequestPermission: async () => ({ allowed: false }) },
    );
  return { connection, manager, execute };
}

afterEach(() => vi.unstubAllEnvs());

test('fork startup adopts the returned id, targets the destination workspace, and routes prompts independently', async () => {
  const { connection, manager, execute } = setup();
  const handle = await execute();
  expect(connection.unstable_forkSession).toHaveBeenCalledWith({
    sessionId: 'source-agent-id',
    cwd: '/tmp/destination-worktree',
    mcpServers: [],
  });
  expect(connection.newSession).not.toHaveBeenCalled();
  expect(handle.history).toBe('restored');
  expect(manager.registerActiveSession).toHaveBeenLastCalledWith(
    'forked-agent-id',
    expect.objectContaining({ localSessionId: 'local-fork' }),
    'provider',
  );
  await handle.prompt('Continue');
  expect(connection.prompt).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: 'forked-agent-id' }),
  );
  await handle.close();
  expect(manager.closeSession).toHaveBeenCalledWith('provider', 'forked-agent-id');
});

test.each(['unadvertised', 'method-not-found'])(
  'falls back to local history for %s fork support',
  async (reason) => {
    const { connection, execute } = setup(reason !== 'unadvertised');
    connection.unstable_forkSession.mockRejectedValue({ code: -32601 });
    const handle = await execute();
    expect(handle.id).toBe('fresh-agent-id');
    expect(handle.history).toBe('fresh');
    expect(connection.newSession).toHaveBeenCalledTimes(1);
    expect(connection.unstable_forkSession).toHaveBeenCalledTimes(
      reason === 'unadvertised' ? 0 : 1,
    );
  },
);

test.each(['error', 'timeout', 'same-id'])(
  'does not create a second session after an ambiguous fork %s',
  async (failure) => {
    const { connection, execute } = setup();
    if (failure === 'error')
      connection.unstable_forkSession.mockRejectedValue(new Error('connection lost'));
    if (failure === 'same-id')
      connection.unstable_forkSession.mockResolvedValue({ sessionId: 'source-agent-id' });
    if (failure === 'timeout') {
      vi.stubEnv('AGENTCTL_AGENT_REQUEST_TIMEOUT_MS', '5');
      connection.unstable_forkSession.mockReturnValue(new Promise(() => {}));
    }
    await expect(execute()).rejects.toThrow();
    expect(connection.newSession).not.toHaveBeenCalled();
    expect(connection.unstable_forkSession).toHaveBeenCalledTimes(1);
  },
);
