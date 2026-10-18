import { agent, methods, ndJsonStream, RequestError } from '@agentclientprotocol/sdk';
import * as v2 from '@agentclientprotocol/sdk/experimental/v2';
import { authMethodSchema, EMPTY_AGENT_FEATURES } from '@agentctl/shared';
import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vite-plus/test';
import { noopLogger } from '../logger.js';
import { createCompactionProjector } from './protocol/compaction.js';
import { AcpV1AgentDriver } from './v1/driver.js';
import { parseAcpCapabilities } from './v1/capabilities.js';
import { PersistentAgentConnectionManager } from './transport/persistent-connection.js';
import { AcpV2AgentDriver } from './v2/driver.js';

// Exercise the regressions identified during the ACP audit through SDK peers.
function streams() {
  const outgoing = new TransformStream<Uint8Array>();
  const incoming = new TransformStream<Uint8Array>();
  const child = new EventEmitter();
  const transport = {
    stdin: outgoing.writable,
    stdout: incoming.readable,
    child,
    closed: new Promise<void>(() => {}),
    isAlive: true,
    kill: vi.fn(),
  };
  return { child, transport, peer: { outgoing, incoming } };
}

test('compaction null summary clears old content', () => {
  const project = createCompactionProjector();
  project({
    sessionUpdate: 'compaction_update',
    compactionId: 'c',
    status: 'completed',
    summary: [{ type: 'text', text: 'old summary' }],
  });
  const events = project({
    sessionUpdate: 'compaction_update',
    compactionId: 'c',
    status: 'completed',
    summary: null,
  });
  expect(events[0]).toMatchObject({ call: { rawOutput: { summary: '' } } });
});

test('compaction signals context invalidation only when completion is first reported', () => {
  const project = createCompactionProjector();
  const update = (status: string) =>
    project({ sessionUpdate: 'compaction_update', compactionId: 'c', status });
  expect(update('in_progress').some((event) => event.type === 'context_compacted')).toBe(false);
  expect(update('failed').some((event) => event.type === 'context_compacted')).toBe(false);
  expect(update('completed')).toContainEqual({ type: 'context_compacted', compactionId: 'c' });
  expect(update('completed').some((event) => event.type === 'context_compacted')).toBe(false);
  expect(
    project({
      sessionUpdate: 'compaction_summary_chunk',
      compactionId: 'c',
      content: { type: 'text', text: 'summary' },
    }).some((event) => event.type === 'context_compacted'),
  ).toBe(false);
});

test('late close from an old connection preserves a replacement session with the same ID', async () => {
  const manager = new PersistentAgentConnectionManager({} as never, {} as never, {} as never);
  const connections = (manager as unknown as { connections: Map<string, unknown> }).connections;
  const make = (generation: number) => ({
    providerId: 'provider',
    generation,
    child: new EventEmitter(),
    idleTimer: null,
    transport: { closed: new Promise<void>(() => {}), isAlive: true, kill: vi.fn() },
    connection: {
      closed: new Promise<void>(() => {}),
      newSession: vi.fn().mockResolvedValue({ sessionId: 'same' }),
      closeSession: vi.fn().mockResolvedValue({}),
      close: vi.fn(),
    },
    capabilities: parseAcpCapabilities({ sessionCapabilities: { close: {} } }),
    sessions: new Map([['sibling', {}]]),
    activeSessions: new Map(),
    terminalToSession: new Map(),
    terminalManager: { release: vi.fn(), dispose: vi.fn() },
  });
  const old = make(1);
  connections.set('provider', old);
  const runtime = new AcpV1AgentDriver();
  runtime.setConnectionManager(manager);
  const handle = await runtime.startSession(
    'agent',
    [],
    {
      cwd: '/tmp',
      providerId: 'provider',
      intent: { kind: 'new' },
      features: EMPTY_AGENT_FEATURES,
    },
    { onUpdate() {}, onRequestPermission: async () => ({ allowed: false }) },
  );
  const replacement = make(2);
  replacement.sessions.set('same', {});
  replacement.activeSessions.set('same', {});
  connections.set('provider', replacement);
  await handle.close();
  if (old.idleTimer) clearTimeout(old.idleTimer);
  if (replacement.idleTimer) clearTimeout(replacement.idleTimer);
  expect(replacement.connection.closeSession).not.toHaveBeenCalled();
  expect(replacement.activeSessions.has('same')).toBe(true);
  expect(old.connection.closeSession).not.toHaveBeenCalled();
});

test('delayed session creation cannot register into a replacement connection', async () => {
  const manager = new PersistentAgentConnectionManager({} as never, {} as never, {} as never);
  const connections = (manager as unknown as { connections: Map<string, unknown> }).connections;
  const created = Promise.withResolvers<{ sessionId: string }>();
  const make = (generation: number) => ({
    providerId: 'provider',
    generation,
    child: new EventEmitter(),
    idleTimer: null as ReturnType<typeof setTimeout> | null,
    transport: { closed: new Promise<void>(() => {}), isAlive: true, kill: vi.fn() },
    connection: {
      closed: new Promise<void>(() => {}),
      newSession: vi.fn(() => created.promise),
      closeSession: vi.fn().mockResolvedValue({}),
      close: vi.fn(),
    },
    capabilities: parseAcpCapabilities({ sessionCapabilities: { close: {} } }),
    sessions: new Map(),
    activeSessions: new Map(),
    terminalToSession: new Map(),
    terminalManager: { release: vi.fn(), dispose: vi.fn() },
  });
  const old = make(1);
  connections.set('provider', old);
  const runtime = new AcpV1AgentDriver();
  runtime.setConnectionManager(manager);
  const starting = runtime.startSession(
    'agent',
    [],
    {
      cwd: '/tmp',
      providerId: 'provider',
      features: EMPTY_AGENT_FEATURES,
      intent: { kind: 'new' },
    },
    { onUpdate() {}, onRequestPermission: async () => ({ allowed: false }) },
  );
  const rejected = expect(starting).rejects.toThrow('lease is no longer active');
  try {
    await vi.waitFor(() => expect(old.connection.newSession).toHaveBeenCalled());
    const replacement = make(2);
    connections.set('provider', replacement);
    created.resolve({ sessionId: 'same' });
    await rejected;
    expect(replacement.activeSessions.size).toBe(0);
    expect(replacement.connection.closeSession).not.toHaveBeenCalled();
  } finally {
    if (old.idleTimer) clearTimeout(old.idleTimer);
  }
});

test.each(['initialize', 'logout'] as const)(
  'v1 provider logout cleans up an unresponsive %s operation',
  async (stalled) => {
    const { child, transport, peer } = streams();
    const app = agent({ name: 'deadline-peer' });
    const initialized = vi.fn();
    const logout = vi.fn();
    app.onRequest(methods.agent.initialize, () => {
      initialized();
      return stalled === 'initialize'
        ? new Promise<never>(() => {})
        : { protocolVersion: 1, agentCapabilities: { auth: { logout: {} } } };
    });
    app.onRequest(methods.agent.logout, () => {
      logout();
      return new Promise<never>(() => {});
    });
    const connection = app.connect(ndJsonStream(peer.incoming.writable, peer.outgoing.readable));
    const runtime = new AcpV1AgentDriver(
      (() => child) as never,
      noopLogger,
      () => transport as never,
    );
    vi.useFakeTimers();
    try {
      const pending = runtime.logoutProvider('agent', []);
      const rejected = expect(pending).rejects.toThrow('operation');
      await vi.waitFor(() =>
        expect(stalled === 'initialize' ? initialized : logout).toHaveBeenCalled(),
      );
      await vi.advanceTimersByTimeAsync(5_001);
      await rejected;
      expect(transport.kill).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      connection.close();
    }
  },
);

test('v2 terminal auth variables become a validated product environment', async () => {
  const { child, transport, peer } = streams();
  const app = v2.agent({ name: 'audit' });
  app.onRequest(v2.methods.agent.initialize, () => ({
    protocolVersion: 2,
    info: { name: 'audit', version: '1' },
    capabilities: {},
    authMethods: [
      {
        type: 'terminal',
        methodId: 'login',
        name: 'Login',
        env: [{ name: 'AUDIT_AUTH', value: 'example' }],
      },
    ],
  }));
  const connection = app.connect(v2.ndJsonStream(peer.incoming.writable, peer.outgoing.readable));
  try {
    const runtime = new AcpV2AgentDriver(
      (() => child) as never,
      noopLogger,
      () => transport as never,
    );
    const result = await runtime.inspectProvider('agent', []);
    expect(result.authMethods[0]).toMatchObject({ env: { AUDIT_AUTH: 'example' } });
    expect(authMethodSchema.safeParse(result.authMethods[0]).success).toBe(true);
  } finally {
    connection.close();
  }
});

test('v1 probe advertises terminal authentication without filesystem access', async () => {
  const { child, transport, peer } = streams();
  const app = agent({ name: 'audit' });
  const initialization = vi.fn();
  app.onRequest(methods.agent.initialize, ({ params }) => {
    initialization(params);
    return {
      protocolVersion: 1,
      agentInfo: { name: 'audit', version: '1' },
      agentCapabilities: {},
      authMethods: params.clientCapabilities?.auth?.terminal
        ? [{ id: 'login', type: 'terminal' as const, name: 'Login' }]
        : [],
    };
  });
  app.onRequest(methods.agent.session.new, () => ({ sessionId: 'probe' }));
  const connection = app.connect(ndJsonStream(peer.incoming.writable, peer.outgoing.readable));
  try {
    const runtime = new AcpV1AgentDriver(
      (() => child) as never,
      noopLogger,
      () => transport as never,
      { get: async () => null, set: async () => {} },
    );
    const result = await runtime.inspectProvider('agent', []);
    expect(initialization.mock.calls[0][0].clientCapabilities.auth.terminal).toBe(true);
    expect(result.authMethods).toMatchObject([{ id: 'login', type: 'terminal' }]);
    expect(initialization.mock.calls[0][0].clientCapabilities.fs.readTextFile).toBe(false);
    expect(initialization.mock.calls[0][0].clientCapabilities.terminal).toBe(false);
  } finally {
    connection.close();
  }
});

test('v1 inspection retains needs-auth behavior when initialization requires authentication', async () => {
  const { child, transport, peer } = streams();
  const app = agent().onRequest(methods.agent.initialize, () => {
    throw RequestError.authRequired();
  });
  const connection = app.connect(ndJsonStream(peer.incoming.writable, peer.outgoing.readable));
  try {
    const driver = new AcpV1AgentDriver(
      (() => child) as never,
      noopLogger,
      () => transport as never,
      { get: async () => null, set: async () => {} },
    );
    await expect(driver.inspectProvider('agent', [])).resolves.toMatchObject({
      status: 'needs_auth',
      authMethods: [],
    });
    expect(transport.kill).toHaveBeenCalledOnce();
  } finally {
    connection.close();
  }
});

test('v1 projection failures fail completion and do not poison the next turn', async () => {
  const { child, transport, peer } = streams();
  let prompts = 0;
  const app = agent({ name: 'projection-peer' })
    .onRequest(methods.agent.initialize, () => ({ protocolVersion: 1, agentCapabilities: {} }))
    .onRequest(methods.agent.session.new, () => ({ sessionId: 'session' }))
    .onRequest(methods.agent.session.prompt, async ({ client }) => {
      if (++prompts === 1) {
        await client.notify(methods.client.session.update, {
          sessionId: 'session',
          update: {
            sessionUpdate: 'compaction_update',
            compactionId: 'compaction',
            status: 'completed',
            _meta: { oversized: 'x'.repeat(65 * 1024) },
          },
        });
      } else
        await client.notify(methods.client.session.update, {
          sessionId: 'session',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'next turn' },
          },
        });
      return { stopReason: 'end_turn' };
    });
  const connection = app.connect(ndJsonStream(peer.incoming.writable, peer.outgoing.readable));
  const runtime = new AcpV1AgentDriver(
    (() => child) as never,
    noopLogger,
    () => transport as never,
  );
  const session = await runtime.startSession(
    'agent',
    [],
    { cwd: '/tmp', features: EMPTY_AGENT_FEATURES, intent: { kind: 'new' } },
    { onUpdate() {}, onRequestPermission: async () => ({ allowed: false }) },
  );
  try {
    await expect(session.prompt('first')).rejects.toThrow('compaction metadata budget');
    await expect(session.prompt('second')).resolves.toMatchObject({ stopReason: 'end_turn' });
  } finally {
    await session.close();
    connection.close();
  }
});
