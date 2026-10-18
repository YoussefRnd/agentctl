import { agent, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { expect, it, vi } from 'vite-plus/test';
import { connectAcpClient } from './client-connection.js';
import { wrapDebug } from './stream-debug.js';
import { AGENTCTL_CLIENT_CAPABILITIES } from '../v1/capabilities.js';
import type { SubagentNotification } from '../protocol/subagent-sessions.js';
import { noopLogger } from '../../logger.js';
import { TerminalManager } from '../protocol/terminal-manager.js';
import type { AgentSessionCallbacks, AgentUpdate } from '../../agent/types.js';

it('advertises SDK subagent support on the wire and routes native child activity/requests over the SDK transport', async () => {
  const toAgent = new TransformStream<Uint8Array>();
  const toClient = new TransformStream<Uint8Array>();
  const events: AgentUpdate[] = [];
  const callbacks: AgentSessionCallbacks = {
    onUpdate: (event) => {
      events.push(event);
    },
    onRequestPermission: vi.fn(async () => ({ allowed: true, optionId: 'allow' })),
    onRequestElicitation: vi.fn(async () => ({ action: 'decline' as const })),
  };
  const terminalManager = new TerminalManager(noopLogger);
  const connection = await connectAcpClient(
    {
      cwd: '/tmp',
      logger: noopLogger,
      terminalManager,
      resolveSession: ({ sessionId } = {}) => {
        if (sessionId !== 'root') throw new Error('Unknown root');
        return { callbacks, cwd: '/tmp' };
      },
    },
    ndJsonStream(toAgent.writable, toClient.readable),
  );
  const rawPeer = ndJsonStream(toClient.writable, toAgent.readable);
  let initializeFrame: unknown;
  const peerStream = wrapDebug(rawPeer, (direction, frame) => {
    if (
      direction === 'recv' &&
      typeof frame === 'object' &&
      frame &&
      'method' in frame &&
      frame.method === 'initialize'
    )
      initializeFrame = frame;
  });
  const peer = agent()
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {},
    }))
    .connect(peerStream);
  const emit = (sessionId: string, update: SubagentNotification['update']) =>
    peer.client.notify(methods.client.session.update, { sessionId, update });
  try {
    await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: AGENTCTL_CLIENT_CAPABILITIES,
    });
    expect(initializeFrame).toMatchObject({ params: { clientCapabilities: { subagents: {} } } });
    await emit('root', {
      sessionUpdate: 'subagent_update',
      sessionId: 'a',
      title: 'A',
      state: { state: 'running' },
    });
    await emit('root', { sessionUpdate: 'subagent_update', sessionId: 'b', title: 'B' });
    await peer.client.notify(methods.client.session.update, {
      sessionId: 'a',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'same',
        title: 'Read A',
        name: 'read_a',
        kind: 'read',
        rawInput: { path: '/tmp/a' },
      },
    });
    await peer.client.notify(methods.client.session.update, {
      sessionId: 'b',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'same',
        title: 'Read B',
        name: 'read_b',
        kind: 'read',
        rawInput: { path: '/tmp/b' },
      },
    });
    const permission = await peer.client.request(methods.client.session.requestPermission, {
      sessionId: 'a',
      toolCall: { toolCallId: 'same' },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    });
    expect(permission).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
    expect(callbacks.onRequestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        subagentId: 'a',
        toolCall: expect.objectContaining({ name: 'read_a', arguments: { path: '/tmp/a' } }),
      }),
      expect.any(AbortSignal),
    );
    await peer.client.notify(methods.client.session.update, {
      sessionId: 'b',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'B reply' } },
    });
    await vi.waitFor(() =>
      expect(events).toContainEqual({
        type: 'subagent_event',
        subagentId: 'b',
        event: expect.objectContaining({ type: 'text', text: 'B reply' }),
      }),
    );
    await emit('root', {
      sessionUpdate: 'session_message',
      messageId: 'm',
      senderSessionId: 'root',
      recipientSessionId: 'a',
      content: [{ type: 'text', text: 'Investigate' }],
    });
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'session_message', content: 'Investigate' }),
      ),
    );
    expect(
      await peer.client.request(methods.client.elicitation.create, {
        sessionId: 'a',
        mode: 'form',
        message: 'Choose',
        requestedSchema: { type: 'object', properties: {} },
      }),
    ).toEqual({ action: 'decline' });
    expect(callbacks.onRequestElicitation).toHaveBeenCalledWith(
      expect.objectContaining({ subagentId: 'a' }),
      expect.any(AbortSignal),
    );
    await expect(
      peer.client.request(methods.client.fs.readTextFile, { sessionId: 'a', path: '/etc/passwd' }),
    ).rejects.toThrow();
  } finally {
    peer.close();
    connection.close?.();
    await terminalManager.dispose();
  }
});

it('retains replay provenance for SDK child updates received before load completes', async () => {
  const toAgent = new TransformStream<Uint8Array>();
  const toClient = new TransformStream<Uint8Array>();
  const events: AgentUpdate[] = [];
  const callbacks: AgentSessionCallbacks = {
    onUpdate: (event) => {
      events.push(event);
    },
    onRequestPermission: async () => ({ allowed: false }),
  };
  let ready = false;
  const terminalManager = new TerminalManager(noopLogger);
  const connection = await connectAcpClient(
    {
      cwd: '/tmp',
      logger: noopLogger,
      terminalManager,
      resolveSession: ({ sessionId } = {}) => {
        if (!ready || sessionId !== 'root') throw new Error('Unknown root');
        return { callbacks, cwd: '/tmp' };
      },
    },
    ndJsonStream(toAgent.writable, toClient.readable),
  );
  const peer = agent()
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
    }))
    .onRequest(methods.agent.session.load, async ({ client }) => {
      await client.notify(methods.client.session.update, {
        sessionId: 'root',
        update: {
          sessionUpdate: 'subagent_update',
          sessionId: 'child',
          capabilities: { cancel: {} },
          state: { state: 'running' },
        },
      });
      return {};
    })
    .connect(ndJsonStream(toClient.writable, toAgent.readable));
  try {
    await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: AGENTCTL_CLIENT_CAPABILITIES,
    });
    await connection.loadSession({ sessionId: 'root', cwd: '/tmp', mcpServers: [] });
    ready = true;
    await connection.flushPendingSessionUpdates?.();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'subagent_update',
        association: expect.objectContaining({ subagentId: 'child', historical: true }),
      }),
    );
    await peer.client.notify(methods.client.session.update, {
      sessionId: 'root',
      update: { sessionUpdate: 'subagent_update', sessionId: 'child', title: 'Live title' },
    });
    await vi.waitFor(() =>
      expect(events.at(-1)).toMatchObject({
        type: 'subagent_update',
        association: { historical: false, state: null, capabilities: null },
      }),
    );
  } finally {
    peer.close();
    connection.close?.();
    await terminalManager.dispose();
  }
});
