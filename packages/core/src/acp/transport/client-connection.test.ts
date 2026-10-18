import { agent, methods, ndJsonStream } from '@agentclientprotocol/sdk';
import { describe, expect, it, vi } from 'vite-plus/test';
import { connectAcpClient } from './client-connection.js';
import { TerminalManager } from '../protocol/terminal-manager.js';
import { noopLogger } from '../../logger.js';
import type { AgentSessionCallbacks } from '../../agent/types.js';

async function pair(callbacks: AgentSessionCallbacks, app = agent()) {
  const toAgent = new TransformStream<Uint8Array>();
  const toClient = new TransformStream<Uint8Array>();
  const terminalManager = new TerminalManager(noopLogger);
  const connection = await connectAcpClient(
    {
      cwd: '/tmp',
      terminalManager,
      logger: noopLogger,
      resolveSession: () => ({ callbacks, cwd: '/tmp' }),
    },
    ndJsonStream(toAgent.writable, toClient.readable),
  );
  const peer = app.connect(ndJsonStream(toClient.writable, toAgent.readable));
  return { connection, peer, terminalManager };
}

const permission = (id: string) => ({
  sessionId: 's',
  toolCall: { toolCallId: id, title: 'Run tool' },
  options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' as const }],
});

it('an update for an unknown session cannot block subsequent active-session updates', async () => {
  const events: unknown[] = [];
  const toAgent = new TransformStream<Uint8Array>();
  const toClient = new TransformStream<Uint8Array>();
  const terminalManager = new TerminalManager(noopLogger);
  const callbacks: AgentSessionCallbacks = {
    onUpdate: (event) => {
      events.push(event);
    },
    onRequestPermission: async () => ({ allowed: false }),
  };
  const connection = await connectAcpClient(
    {
      cwd: '/tmp',
      terminalManager,
      logger: noopLogger,
      resolveSession: ({ sessionId } = {}) => {
        if (sessionId !== 'active') throw new Error('Unknown session');
        return { callbacks, cwd: '/tmp' };
      },
    },
    ndJsonStream(toAgent.writable, toClient.readable),
  );
  const peer = agent().connect(ndJsonStream(toClient.writable, toAgent.readable));
  try {
    for (const sessionId of ['closed', 'active', 'active'])
      await peer.client.notify(methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: sessionId },
        },
      });
    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(events).toEqual([
      { type: 'text', text: 'active' },
      { type: 'text', text: 'active' },
    ]);
  } finally {
    connection.close?.();
    peer.close();
    await terminalManager.dispose();
  }
});

it.each(['permission', 'form'] as const)(
  'responds to %s cancellation even when its UI callback is still pending',
  async (kind) => {
    const consent = vi.fn(() => new Promise<never>(() => {}));
    const { peer, connection } = await pair({
      onUpdate() {},
      onRequestPermission: consent,
      onRequestElicitation: consent,
    });
    try {
      const abort = new AbortController();
      const pending =
        kind === 'permission'
          ? peer.client.request(methods.client.session.requestPermission, permission('t'), {
              cancellationSignal: abort.signal,
            })
          : peer.client.request(
              methods.client.elicitation.create,
              {
                sessionId: 's',
                mode: 'form',
                message: 'Choose',
                requestedSchema: { type: 'object', properties: {} },
              },
              { cancellationSignal: abort.signal },
            );
      const result = expect(pending).resolves.toEqual(
        kind === 'permission' ? { outcome: { outcome: 'cancelled' } } : { action: 'cancel' },
      );
      await vi.waitFor(() => expect(consent).toHaveBeenCalledOnce());
      abort.abort();
      await result;
    } finally {
      peer.close();
      connection.close?.();
    }
  },
);

describe('v1 request cancellation over the SDK transport', () => {
  it('cancels one permission waiter while leaving another request usable', async () => {
    const signals: AbortSignal[] = [];
    let allowSecond!: () => void;
    const onRequestPermission = vi.fn((_request, signal?: AbortSignal) => {
      signals.push(signal!);
      return new Promise<{ allowed: boolean; cancelled?: boolean; optionId?: string }>(
        (resolve) => {
          signal!.addEventListener('abort', () => resolve({ allowed: false, cancelled: true }), {
            once: true,
          });
          if (signals.length === 2)
            allowSecond = () => resolve({ allowed: true, optionId: 'allow' });
        },
      );
    });
    const { peer, connection } = await pair({ onUpdate() {}, onRequestPermission });
    try {
      const abort = new AbortController();
      const first = peer.client.request(methods.client.session.requestPermission, permission('a'), {
        cancellationSignal: abort.signal,
      });
      const cancellation = expect(first).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
      const second = peer.client.request(methods.client.session.requestPermission, permission('b'));
      await vi.waitFor(() => expect(signals).toHaveLength(2));
      abort.abort();
      await cancellation;
      await vi.waitFor(() => expect(signals[0].aborted).toBe(true));
      expect(signals[1].aborted).toBe(false);
      allowSecond();
      expect(await second).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
    } finally {
      peer.close();
      connection.close?.();
    }
  });

  it('forwards individual form cancellation to the session callback', async () => {
    let received: AbortSignal | undefined;
    const { peer, connection } = await pair({
      onUpdate() {},
      onRequestPermission: async () => ({ allowed: false }),
      onRequestElicitation: (_request, signal) => {
        received = signal;
        return new Promise((resolve) =>
          signal!.addEventListener('abort', () => resolve({ action: 'cancel' }), { once: true }),
        );
      },
    });
    try {
      const abort = new AbortController();
      const pending = peer.client.request(
        methods.client.elicitation.create,
        {
          sessionId: 's',
          mode: 'form',
          message: 'Choose',
          requestedSchema: { type: 'object', properties: { name: { type: 'string' } } },
        },
        { cancellationSignal: abort.signal },
      );
      const cancellation = expect(pending).resolves.toEqual({ action: 'cancel' });
      await vi.waitFor(() => expect(received).toBeDefined());
      abort.abort();
      await cancellation;
      await vi.waitFor(() => expect(received!.aborted).toBe(true));
    } finally {
      peer.close();
      connection.close?.();
    }
  });
});

it('routes v1 forms to the exact outstanding request and declines stale scopes', async () => {
  const onRequestElicitation = vi.fn(async () => ({
    action: 'submit' as const,
    values: { name: 'valid' },
  }));
  const app = agent().onRequest(methods.agent.session.prompt, async ({ client, requestId }) => {
    const response = await client.request(methods.client.elicitation.create, {
      requestId,
      mode: 'form',
      message: 'Name',
      requestedSchema: { type: 'object', properties: { name: { type: 'string' } } },
    });
    expect(response).toEqual({ action: 'accept', content: { name: 'valid' } });
    return { stopReason: 'end_turn' };
  });
  const { connection, peer } = await pair(
    {
      onUpdate() {},
      onRequestPermission: async () => ({ allowed: false }),
      onRequestElicitation,
    },
    app,
  );
  try {
    await connection.prompt({ sessionId: 's', prompt: [{ type: 'text', text: 'ask' }] });
    const response = await peer.client.request(methods.client.elicitation.create, {
      requestId: 'stale',
      mode: 'form',
      message: 'Name',
      requestedSchema: { type: 'object', properties: { name: { type: 'string' } } },
    });
    expect(response).toEqual({ action: 'decline' });
    expect(onRequestElicitation).toHaveBeenCalledOnce();
  } finally {
    peer.close();
    connection.close?.();
  }
});

it.each(['write', 'terminal', 'extension'] as const)(
  'cancels pending %s consent before executing the operation',
  async (operation) => {
    let signal: AbortSignal | undefined;
    let approve!: (response: { allowed: boolean; optionId: string }) => void;
    const { peer, connection, terminalManager } = await pair({
      onUpdate() {},
      onRequestPermission: (_request, requestSignal) => {
        signal = requestSignal;
        return new Promise((resolve) => {
          approve = resolve;
        });
      },
    });
    const spawn = vi.spyOn(terminalManager, 'spawn').mockReturnValue('terminal');
    const abort = new AbortController();
    try {
      const pending =
        operation === 'write'
          ? peer.client.request(
              methods.client.fs.writeTextFile,
              { sessionId: 's', path: '/tmp/agentctl-cancelled-write', content: 'test' },
              { cancellationSignal: abort.signal },
            )
          : operation === 'terminal'
            ? peer.client.request(
                methods.client.terminal.create,
                { sessionId: 's', command: 'unused' },
                { cancellationSignal: abort.signal },
              )
            : peer.client.request(
                '_agentctl.dev/builtin/bash',
                { sessionId: 's', command: 'unused', pty: true },
                { cancellationSignal: abort.signal },
              );
      const rejected = expect(pending).rejects.toMatchObject({ code: -32800 });
      await vi.waitFor(() => expect(signal).toBeDefined());
      abort.abort();
      await rejected;
      expect(signal!.aborted).toBe(true);
      approve({ allowed: true, optionId: 'allow_once' });
      await Promise.resolve();
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      peer.close();
      connection.close?.();
    }
  },
);

it('cancels a terminal wait without killing or releasing the terminal', async () => {
  const { peer, connection, terminalManager } = await pair({
    onUpdate() {},
    onRequestPermission: async () => ({ allowed: true }),
  });
  let exit!: (value: { exitCode: number; signal: null }) => void;
  const closed = new Promise<{ exitCode: number; signal: null }>((resolve) => {
    exit = resolve;
  });
  vi.spyOn(terminalManager, 'spawn').mockReturnValue('terminal');
  vi.spyOn(terminalManager, 'getTerminal').mockReturnValue({
    output: 'still running',
    truncated: false,
    hasExited: false,
    closed,
  } as ReturnType<TerminalManager['getTerminal']>);
  const release = vi.spyOn(terminalManager, 'release');
  const kill = vi.spyOn(terminalManager, 'kill');
  try {
    await peer.client.request(methods.client.terminal.create, {
      sessionId: 's',
      command: 'unused',
    });
    const abort = new AbortController();
    const pending = peer.client.request(
      methods.client.terminal.waitForExit,
      { sessionId: 's', terminalId: 'terminal' },
      { cancellationSignal: abort.signal },
    );
    const rejected = expect(pending).rejects.toMatchObject({ code: -32800 });
    abort.abort();
    await rejected;
    expect(release).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
    expect(
      await peer.client.request(methods.client.terminal.output, {
        sessionId: 's',
        terminalId: 'terminal',
      }),
    ).toEqual({ output: 'still running', truncated: false });
    exit({ exitCode: 0, signal: null });
  } finally {
    peer.close();
    connection.close?.();
  }
});
