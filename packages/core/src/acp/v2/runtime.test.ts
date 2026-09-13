import { EventEmitter } from 'node:events';
import type { ChildProcess, spawn } from 'node:child_process';
import { describe, expect, test, vi } from 'vitest';
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk/experimental/v2';
import { EMPTY_AGENT_FEATURES } from '@agentctl/shared';
import type { AgentStreamTransport } from '../types.js';
import { AcpV2AgentDriver } from './runtime.js';
import { runAgentDriverConformance } from '../../agent/conformance.js';

function harness() {
  const clientToAgent = new TransformStream<Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array>();
  const child = new EventEmitter() as ChildProcess;
  let killed = false;
  const transport: AgentStreamTransport = {
    stdin: clientToAgent.writable,
    stdout: agentToClient.readable,
    closed: new Promise<void>(() => undefined),
    child,
    isAlive: true,
    kill: vi.fn(() => {
      killed = true;
    }),
  };
  const fakeSpawn = (() => child) as typeof spawn;
  const app = agent({ name: 'test-agent' });
  app.onRequest(methods.agent.initialize, () => ({
    protocolVersion: PROTOCOL_VERSION,
    info: { name: 'test-agent', version: '1.0.0' },
    capabilities: { session: {} },
  }));
  app.onRequest(methods.agent.session.new, () => ({ sessionId: 'v2-session' }));
  app.onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'state_update', state: 'running' },
    });
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'message-1',
        content: { type: 'text', text: 'hello from v2' },
      },
    });
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'state_update',
        state: 'idle',
        stopReason: 'end_turn',
      },
    });
    return {};
  });
  app.onRequest(methods.agent.session.close, () => ({}));
  const agentConnection = app.connect(ndJsonStream(agentToClient.writable, clientToAgent.readable));
  return { transport, fakeSpawn, agentConnection, wasKilled: () => killed };
}

describe('AcpV2AgentDriver', () => {
  test('waits for idle state after prompt acknowledgement and projects updates', async () => {
    const setup = harness();
    const driver = new AcpV2AgentDriver(setup.fakeSpawn, undefined, () => setup.transport);
    const report = await runAgentDriverConformance(driver, {
      cwd: '/tmp',
      features: EMPTY_AGENT_FEATURES,
      intent: { kind: 'new' },
    });

    expect(report.sessionId).toBe('v2-session');
    expect(report.promptResult).toMatchObject({ stopReason: 'end_turn' });
    expect(report.updates).toContainEqual({ type: 'status', status: 'running' });
    expect(report.updates).toContainEqual({
      type: 'text',
      text: 'hello from v2',
      messageId: 'message-1',
      operation: 'append',
    });

    expect(setup.wasKilled()).toBe(true);
    setup.agentConnection.close();
  });
});
