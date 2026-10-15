import { agent, ndJsonStream } from '@agentclientprotocol/sdk';
import * as v2 from '@agentclientprotocol/sdk/experimental/v2';
import { expect, test, vi } from 'vitest';
import { connectAcpClient } from '../transport/client-connection.js';
import { TerminalManager } from './terminal-manager.js';
import { noopLogger } from '../../logger.js';

test.each([
  ['fs/read_text_file', { path: '/tmp/file', line: '1' }],
  ['fs/read_text_file', { path: '/tmp/file', limit: -1 }],
  ['terminal/create', { command: 'echo', args: [42] }],
  ['terminal/create', { command: 'echo', env: [{ name: 'TEST', value: 42 }] }],
  ['terminal/create', { command: 'echo', cwd: false }],
  ['terminal/create', { command: 'echo', outputByteLimit: -1 }],
])(
  'v1 rejects malformed actionable %s parameters before client execution',
  async (method, params) => {
    const toAgent = new TransformStream<Uint8Array>();
    const toClient = new TransformStream<Uint8Array>();
    const permission = vi.fn(async () => ({ allowed: true }));
    const terminals = new TerminalManager(noopLogger);
    const connection = await connectAcpClient(
      {
        cwd: '/tmp',
        terminalManager: terminals,
        logger: noopLogger,
        resolveSession: () => ({
          cwd: '/tmp',
          callbacks: { onUpdate() {}, onRequestPermission: permission },
        }),
      },
      ndJsonStream(toAgent.writable, toClient.readable),
    );
    const peer = agent().connect(ndJsonStream(toClient.writable, toAgent.readable));
    try {
      // Intentionally bypass compile-time builders to exercise incoming wire validation.
      const request = peer.client.request.bind(peer.client) as (
        method: string,
        params: unknown,
      ) => Promise<unknown>;
      await expect(
        request(String(method), { sessionId: 'session', ...(params as object) }),
      ).rejects.toMatchObject({ code: -32602 });
      expect(permission).not.toHaveBeenCalled();
    } finally {
      connection.close?.();
      peer.close();
      await terminals.dispose();
    }
  },
);

test.each([
  { additionalDirectories: ['/tmp/allowed', 42] },
  { mcpServers: [{ type: 'stdio', name: 'server', command: 'echo', args: [42], env: [] }] },
  {
    mcpServers: [
      {
        type: 'http',
        name: 'server',
        url: 'https://example.com',
        headers: [{ name: 'X-Test', value: 42 }],
      },
    ],
  },
])(
  'v2 rejects malformed session setup arrays without silently removing entries: %j',
  async (patch) => {
    const toAgent = new TransformStream<Uint8Array>();
    const toClient = new TransformStream<Uint8Array>();
    const create = vi.fn(() => ({ sessionId: 'session' }));
    const app = v2
      .agent()
      .onRequest(v2.methods.agent.initialize, () => ({
        protocolVersion: 2,
        info: { name: 'peer', version: '1' },
        capabilities: { session: {} },
      }))
      .onRequest(v2.methods.agent.session.new, create);
    const peer = app.connect(v2.ndJsonStream(toClient.writable, toAgent.readable));
    const connection = v2.client().connect(v2.ndJsonStream(toAgent.writable, toClient.readable));
    try {
      await connection.agent.request(v2.methods.agent.initialize, {
        protocolVersion: 2,
        info: { name: 'client', version: '1' },
        capabilities: {},
      });
      const request = connection.agent.request.bind(connection.agent) as (
        method: string,
        params: unknown,
      ) => Promise<unknown>;
      await expect(request('session/new', { cwd: '/tmp', ...patch })).rejects.toMatchObject({
        code: -32602,
      });
      expect(create).not.toHaveBeenCalled();
    } finally {
      connection.close();
      peer.close();
    }
  },
);

test('v2 natively decodes error details, null, omission and malformed errors without metadata markers', async () => {
  const toAgent = new TransformStream<Uint8Array>();
  const toClient = new TransformStream<Uint8Array>();
  const seen: v2.UpdateSessionNotification[] = [];
  const app = v2.agent().onRequest(v2.methods.agent.initialize, () => ({
    protocolVersion: 2,
    info: { name: 'peer', version: '1' },
    capabilities: { session: {} },
  }));
  const peer = app.connect(v2.ndJsonStream(toClient.writable, toAgent.readable));
  const connection = v2
    .client()
    .onNotification(v2.methods.client.session.update, ({ params }) => {
      seen.push(params);
    })
    .connect(v2.ndJsonStream(toAgent.writable, toClient.readable));
  try {
    await connection.agent.request(v2.methods.agent.initialize, {
      protocolVersion: 2,
      info: { name: 'client', version: '1' },
      capabilities: {},
    });
    const notify = peer.client.notify.bind(peer.client) as (
      method: string,
      params: unknown,
    ) => Promise<void>;
    for (const error of [
      { code: -32603, message: 'Failure', data: { retryable: true } },
      null,
      undefined,
      { code: 'malformed' },
    ])
      await notify('session/update', {
        sessionId: 'session',
        update: {
          sessionUpdate: 'state_update',
          state: 'idle',
          stopReason: 'error',
          error,
          _meta: { provider: 'original' },
        },
      });
    await vi.waitFor(() => expect(seen).toHaveLength(4));
    const updates = seen.map(
      (notification) => notification.update as { error?: unknown; _meta?: unknown },
    );
    expect(updates.map((update) => update.error)).toEqual([
      { code: -32603, message: 'Failure', data: { retryable: true } },
      null,
      undefined,
      undefined,
    ]);
    expect(
      updates.every(
        (update) => JSON.stringify(update._meta) === JSON.stringify({ provider: 'original' }),
      ),
    ).toBe(true);
  } finally {
    connection.close();
    peer.close();
  }
});
