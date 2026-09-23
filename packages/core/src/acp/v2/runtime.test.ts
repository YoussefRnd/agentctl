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
  const controls = {
    cancel: vi.fn(),
    setConfigOption: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
    logout: vi.fn(),
    login: vi.fn(),
    resume: vi.fn(),
    fork: vi.fn(),
  };
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
    capabilities: { session: { delete: {}, fork: {} } },
  }));
  app.onRequest(methods.agent.session.new, () => ({ sessionId: 'v2-session' }));
  app.onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    await client.request(methods.client.session.requestPermission, {
      sessionId: params.sessionId,
      title: 'Read example file',
      subject: {
        type: 'tool_call',
        toolCall: { toolCallId: 'tool-1', name: 'read_file', kind: 'read' },
      },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    });
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'state_update', state: 'running' },
    });
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        name: 'read_file',
        status: 'completed',
        kind: 'read',
        locations: [{ path: '/tmp/example.ts' }],
      },
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
    return { messageId: 'message-1' };
  });
  app.onRequest(methods.agent.session.close, () => ({}));
  app.onRequest(methods.agent.session.resume, ({ params }) => {
    controls.resume(params);
    return { configOptions: [] };
  });
  app.onRequest(methods.agent.session.fork, ({ params }) => {
    controls.fork(params);
    return { sessionId: 'v2-fork', configOptions: [] };
  });
  app.onNotification(methods.agent.session.cancel, ({ params }) => {
    controls.cancel(params);
  });
  app.onRequest(methods.agent.session.setConfigOption, ({ params }) => {
    controls.setConfigOption(params);
    return { configOptions: [] };
  });
  app.onRequest(methods.agent.session.list, ({ params }) => {
    controls.list(params);
    return { sessions: [] };
  });
  app.onRequest(methods.agent.session.delete, ({ params }) => {
    controls.delete(params);
    return {};
  });
  app.onRequest(methods.agent.auth.logout, ({ params }) => {
    controls.logout(params);
    return {};
  });
  app.onRequest(methods.agent.auth.login, ({ params }) => {
    controls.login(params);
    return {};
  });
  const agentConnection = app.connect(ndJsonStream(agentToClient.writable, clientToAgent.readable));
  return { transport, fakeSpawn, agentConnection, wasKilled: () => killed, controls };
}

describe('AcpV2AgentDriver', () => {
  test('records provider and protocol provenance during inspection', async () => {
    const setup = harness();
    const driver = new AcpV2AgentDriver(setup.fakeSpawn, undefined, () => setup.transport);

    const descriptor = await driver.inspectProvider(
      'test-agent',
      [],
      {},
      {
        providerVersion: '2.0.0',
      },
    );

    expect(descriptor.snapshot).toMatchObject({
      source: 'handshake',
      providerVersion: '2.0.0',
      protocolVersion: String(PROTOCOL_VERSION),
    });
    expect(descriptor.snapshot?.verifiedAt).toBeInstanceOf(Date);
    setup.agentConnection.close();
  });

  test('passes the shared lifecycle, update, and control contract', async () => {
    const setup = harness();
    const driver = new AcpV2AgentDriver(setup.fakeSpawn, undefined, () => setup.transport);
    const report = await runAgentDriverConformance(
      driver,
      {
        cwd: '/tmp',
        features: EMPTY_AGENT_FEATURES,
        intent: { kind: 'new' },
        resolvedModelConfigId: 'model',
      },
      'conformance prompt',
      {
        cancel: true,
        authMethodId: 'oauth',
        modelId: 'model-2',
        configOption: { id: 'thinking', value: 'high' },
        modeId: 'code',
        listSessions: true,
        deleteSessionId: 'old-session',
        logout: true,
      },
    );

    expect(report.sessionId).toBe('v2-session');
    expect(report.promptResult).toMatchObject({ stopReason: 'end_turn' });
    expect(report.updates).toContainEqual({ type: 'status', status: 'running' });
    expect(report.updates).toContainEqual({
      type: 'text',
      text: 'hello from v2',
      messageId: 'message-1',
      operation: 'append',
    });
    expect(report.updates).toContainEqual(
      expect.objectContaining({
        type: 'tool_call',
        call: expect.objectContaining({ toolCallId: 'tool-1', kind: 'read' }),
      }),
    );
    expect(report.permissionRequests).toEqual([
      expect.objectContaining({
        toolCall: expect.objectContaining({ name: 'read_file', toolCallId: 'tool-1' }),
      }),
    ]);
    expect(report.exercisedOperations).toEqual([
      'prompt',
      'cancel',
      'authenticate',
      'update_model',
      'update_config',
      'set_mode',
      'list_sessions',
      'delete_session',
      'logout',
    ]);
    expect(setup.controls.cancel).toHaveBeenCalled();
    expect(setup.controls.login).toHaveBeenCalled();
    expect(setup.controls.setConfigOption).toHaveBeenCalledTimes(3);
    expect(setup.controls.list).toHaveBeenCalled();
    expect(setup.controls.delete).toHaveBeenCalled();
    expect(setup.controls.logout).toHaveBeenCalled();

    expect(setup.wasKilled()).toBe(true);
    setup.agentConnection.close();
  });

  test.each([
    ['resume', 'source-session', 'restored'],
    ['fork', 'v2-fork', 'restored'],
  ] as const)(
    'supports %s session intent through the same contract',
    async (intent, id, history) => {
      const setup = harness();
      const driver = new AcpV2AgentDriver(setup.fakeSpawn, undefined, () => setup.transport);
      const report = await runAgentDriverConformance(driver, {
        providerId: 'provider',
        cwd: '/tmp',
        features: EMPTY_AGENT_FEATURES,
        intent: { kind: intent, sessionId: 'source-session' },
      });
      expect(report).toMatchObject({ sessionId: id, history });
      expect(setup.controls[intent]).toHaveBeenCalled();
      setup.agentConnection.close();
    },
  );
});
