import { EventEmitter } from 'node:events';
import type { ChildProcess, spawn } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
} from '@agentclientprotocol/sdk/experimental/v2';
import { EMPTY_AGENT_FEATURES } from '@agentctl/shared';
import type { AgentSessionCallbacks } from '../../agent/types.js';
import type { AgentStreamTransport } from '../types.js';
import { ACP_MAX_PENDING_UPDATES, ACP_SESSION_OPERATION_TIMEOUT_MS } from '../transport/limits.js';
import { AcpV2AgentDriver } from './driver.js';

afterEach(() => vi.useRealTimers());

function peer(
  options: {
    setupUpdates?: number;
    setupChild?: boolean;
    foreignUser?: boolean;
    lateUser?: boolean;
    rejectPrompt?: boolean;
  } = {},
) {
  const toAgent = new TransformStream<Uint8Array>();
  const toClient = new TransformStream<Uint8Array>();
  const child = new EventEmitter() as ChildProcess;
  let disconnect!: () => void;
  const transport: AgentStreamTransport = {
    child,
    stdin: toAgent.writable,
    stdout: toClient.readable,
    isAlive: true,
    closed: new Promise<void>((resolve) => {
      disconnect = resolve;
    }),
    kill: vi.fn(() => disconnect()),
  };
  const list = vi.fn();
  const app = agent({ name: 'lifecycle-peer' })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      info: { name: 'lifecycle-peer', version: '1.0.0' },
      capabilities: { session: {} },
    }))
    .onRequest(methods.agent.session.new, async ({ client }) => {
      if (options.setupChild)
        await client.notify(methods.client.session.update, {
          sessionId: 'session',
          update: {
            sessionUpdate: 'subagent_update',
            sessionId: 'child',
            title: 'Child',
            state: { state: 'running' },
          },
        });
      for (let index = 0; index < (options.setupUpdates ?? 0); index++)
        await client.notify(methods.client.session.update, {
          sessionId: 'session',
          update: {
            sessionUpdate: 'agent_message_chunk',
            messageId: 'replayed',
            content: { type: 'text', text: 'chunk' },
          },
        });
      return { sessionId: 'session' };
    })
    .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
      if (options.foreignUser)
        await client.notify(methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'user_message',
            messageId: 'other-client',
            content: params.prompt,
          },
        });
      if (options.rejectPrompt) throw RequestError.invalidParams(undefined, 'Input rejected');
      if (!options.lateUser)
        await client.notify(methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'user_message',
            messageId: 'inserted-user',
            content: params.prompt,
          },
        });
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: 'state_update', state: 'running' },
      });
      return { messageId: 'inserted-user' };
    })
    .onRequest(methods.agent.session.close, () => ({}))
    .onRequest(methods.agent.session.list, () => {
      list();
      return new Promise<never>(() => {});
    });
  const cancel = vi.fn();
  app.onNotification(methods.agent.session.cancel, async () => {
    cancel();
    await connection.client.notify(methods.client.session.update, {
      sessionId: 'session',
      update: { sessionUpdate: 'state_update', state: 'idle', stopReason: 'cancelled' },
    });
  });
  const connection = app.connect(ndJsonStream(toClient.writable, toAgent.readable));
  const driver = new AcpV2AgentDriver((() => child) as typeof spawn, undefined, () => transport);
  const start = (
    callbacks: AgentSessionCallbacks = {
      onUpdate() {},
      onRequestPermission: async () => ({ allowed: false }),
    },
  ) =>
    driver.startSession(
      'agent',
      [],
      { cwd: '/tmp', features: EMPTY_AGENT_FEATURES, intent: { kind: 'new' } },
      callbacks,
    );
  return { connection, transport, start, disconnect, list, cancel };
}

test('acceptance does not complete foreground work, and closing settles its pending prompt', async () => {
  const h = peer();
  const update = vi.fn();
  const session = await h.start({
    onUpdate: update,
    onRequestPermission: async () => ({ allowed: false }),
  });
  const pending = session.prompt('hello');
  const failed = expect(pending).rejects.toThrow('session closed');
  let settled = false;
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  try {
    await vi.waitFor(() =>
      expect(update).toHaveBeenCalledWith({ type: 'status', status: 'running' }),
    );
    expect(settled).toBe(false);
    await session.close();
    await failed;
    await expect(session.prompt('after close')).rejects.toThrow('session closed');
  } finally {
    await session.close();
    h.connection.close();
  }
});

test('a clean transport exit rejects foreground work even after prompt acceptance', async () => {
  const h = peer();
  const update = vi.fn();
  const session = await h.start({
    onUpdate: update,
    onRequestPermission: async () => ({ allowed: false }),
  });
  const pending = session.prompt('hello');
  const failed = expect(pending).rejects.toMatchObject({ kind: 'transport_lost' });
  try {
    await vi.waitFor(() =>
      expect(update).toHaveBeenCalledWith({ type: 'status', status: 'running' }),
    );
    h.disconnect();
    await failed;
  } finally {
    await session.close();
    h.connection.close();
  }
});

test.each(['permission', 'form'] as const)(
  'session/cancel cancels pending %s without a peer request-cancel notification',
  async (kind) => {
    const h = peer();
    const consent = vi.fn(() => new Promise<never>(() => {}));
    const session = await h.start({
      onUpdate() {},
      onRequestPermission: consent,
      onRequestElicitation: consent,
    });
    try {
      const pending =
        kind === 'permission'
          ? h.connection.client.request(methods.client.session.requestPermission, {
              sessionId: 'session',
              title: 'Consent',
              options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
            })
          : h.connection.client.request(methods.client.elicitation.create, {
              sessionId: 'session',
              mode: 'form',
              message: 'Choose',
              requestedSchema: { type: 'object', properties: {} },
            });
      await vi.waitFor(() => expect(consent).toHaveBeenCalledOnce());
      await session.cancel();
      expect(await pending).toEqual(
        kind === 'permission' ? { outcome: { outcome: 'cancelled' } } : { action: 'cancel' },
      );
      await vi.waitFor(() => expect(h.cancel).toHaveBeenCalledOnce());
    } finally {
      await session.close();
      h.connection.close();
    }
  },
);

test('session listing times out when a live peer never responds', async () => {
  const h = peer();
  const session = await h.start();
  try {
    vi.useFakeTimers();
    const pending = session.listSessions!({});
    const failed = expect(pending).rejects.toThrow('Timed out while listing ACP sessions');
    await vi.advanceTimersByTimeAsync(ACP_SESSION_OPERATION_TIMEOUT_MS + 1);
    await failed;
    expect(h.list).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
    await session.close();
    h.connection.close();
  }
});

test('setup update overflow fails startup and retires the process', async () => {
  const h = peer({ setupUpdates: ACP_MAX_PENDING_UPDATES + 1 });
  try {
    await expect(h.start()).rejects.toThrow('Too many ACP updates before session setup');
    expect(h.transport.kill).toHaveBeenCalled();
  } finally {
    h.connection.close();
  }
});

test('a new session’s early child announcement retains its live state', async () => {
  const h = peer({ setupChild: true });
  const update = vi.fn();
  const session = await h.start({
    onUpdate: update,
    onRequestPermission: async () => ({ allowed: false }),
  });
  try {
    expect(update).toHaveBeenCalledWith({
      type: 'subagent_update',
      association: {
        subagentId: 'child',
        parentSessionId: 'session',
        title: 'Child',
        state: { state: 'running' },
        historical: false,
      },
    });
  } finally {
    await session.close();
    h.connection.close();
  }
});

test.each([false, true])(
  'binds accepted user identity before projecting updates, lateUser=%s',
  async (lateUser) => {
    const h = peer({ foreignUser: true, lateUser });
    const update = vi.fn();
    const session = await h.start({
      onUpdate: update,
      onRequestPermission: async () => ({ allowed: false }),
    });
    const pending = session.prompt('same content');
    try {
      await vi.waitFor(() =>
        expect(update).toHaveBeenCalledWith({
          type: 'user_message_accepted',
          messageId: 'inserted-user',
        }),
      );
      if (lateUser)
        await h.connection.client.notify(methods.client.session.update, {
          sessionId: 'session',
          update: {
            sessionUpdate: 'user_message',
            messageId: 'inserted-user',
            content: [{ type: 'text', text: 'same content' }],
          },
        });
      await vi.waitFor(() =>
        expect(update).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'user_text', messageId: 'inserted-user' }),
        ),
      );
      const events = update.mock.calls.map(([event]) => event);
      expect(events.findIndex((e) => e.type === 'user_message_accepted')).toBeLessThan(
        events.findIndex((e) => e.type === 'user_text'),
      );
      expect(events.filter((e) => e.type === 'user_text').map((e) => e.messageId)).toEqual([
        'other-client',
        'inserted-user',
      ]);
      await h.connection.client.notify(methods.client.session.update, {
        sessionId: 'session',
        update: { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' },
      });
      await expect(pending).resolves.toMatchObject({ userMessageId: 'inserted-user' });
    } finally {
      await session.close();
      await pending.catch(() => undefined);
      h.connection.close();
    }
  },
);

test.each([true, false])(
  'preserves foreground error details=%s and allows the next prompt',
  async (details) => {
    const h = peer();
    const update = vi.fn();
    const session = await h.start({
      onUpdate: update,
      onRequestPermission: async () => ({ allowed: false }),
    });
    const error = { code: -32000, message: 'Provider quota exhausted', data: { retryable: true } };
    try {
      const pending = session.prompt('hello');
      await vi.waitFor(() =>
        expect(update).toHaveBeenCalledWith({
          type: 'user_message_accepted',
          messageId: 'inserted-user',
        }),
      );
      await h.connection.client.notify(methods.client.session.update, {
        sessionId: 'session',
        update: {
          sessionUpdate: 'state_update',
          state: 'idle',
          stopReason: 'error',
          ...(details ? { error } : {}),
        },
      });
      await expect(pending).resolves.toMatchObject({
        stopReason: 'error',
        ...(details ? { error } : {}),
      });
      update.mockClear();
      const next = session.prompt('try again');
      await vi.waitFor(() =>
        expect(update).toHaveBeenCalledWith({
          type: 'user_message_accepted',
          messageId: 'inserted-user',
        }),
      );
      await h.connection.client.notify(methods.client.session.update, {
        sessionId: 'session',
        update: { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' },
      });
      await expect(next).resolves.toMatchObject({ stopReason: 'end_turn' });
    } finally {
      await session.close();
      h.connection.close();
    }
  },
);

test('reports a prompt RPC rejection without binding an observed foreign message', async () => {
  const h = peer({ foreignUser: true, rejectPrompt: true });
  const update = vi.fn();
  const session = await h.start({
    onUpdate: update,
    onRequestPermission: async () => ({ allowed: false }),
  });
  try {
    await expect(session.prompt('same content')).rejects.toMatchObject({ kind: 'prompt_rejected' });
    const events = update.mock.calls.map(([event]) => event);
    expect(
      events.filter((event) =>
        ['user_message_accepted', 'user_message_unconfirmed', 'user_text'].includes(event.type),
      ),
    ).toMatchObject([
      { type: 'user_message_unconfirmed' },
      { type: 'user_text', messageId: 'other-client' },
    ]);
  } finally {
    await session.close();
    h.connection.close();
  }
});
