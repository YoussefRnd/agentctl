import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AgentCapabilities,
  type CreateElicitationRequest,
  type NewSessionResponse,
  type SessionConfigOption,
} from '@agentclientprotocol/sdk/experimental/v2';
import { EMPTY_AGENT_FEATURES } from '@agentctl/shared';
import type { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, test, vi } from 'vite-plus/test';
import { context as telemetryContext } from '@opentelemetry/api';
import { restoreTraceContext } from '../../observability/index.js';
import { runAgentDriverConformance } from '../../agent/conformance.js';
import type { AgentUpdate } from '../../agent/types.js';
import type { AgentStreamTransport } from '../types.js';
import { AcpV2AgentDriver } from './driver.js';

function harness(
  configOptions: SessionConfigOption[] = [],
  rejectOnKill = false,
  browserAuth = false,
  elicitation?:
    | CreateElicitationRequest
    | ((requestId: string | number) => CreateElicitationRequest),
  capabilities: AgentCapabilities = { session: { delete: {}, fork: {} } },
  stopReason: 'end_turn' | null = 'end_turn',
  availableCommands?: NewSessionResponse['availableCommands'],
) {
  let rejectClosed!: (error: Error) => void;
  const clientToAgent = new TransformStream<Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array>();
  const child = new EventEmitter() as ChildProcess;
  let killed = false;
  const controls = {
    prompt: vi.fn(),
    initialize: vi.fn(),
    elicitation: vi.fn(),
    cancel: vi.fn(),
    permission: vi.fn(),
    setConfigOption: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
    logout: vi.fn(),
    login: vi.fn(),
    resume: vi.fn(),
    fork: vi.fn(),
    newSession: vi.fn(),
  };
  const transport: AgentStreamTransport = {
    stdin: clientToAgent.writable,
    stdout: agentToClient.readable,
    closed: new Promise<void>((_resolve, reject) => {
      rejectClosed = reject;
    }),
    child,
    isAlive: true,
    kill: vi.fn(() => {
      killed = true;
      if (rejectOnKill) rejectClosed(new Error('Process exited with code 130'));
    }),
  };
  const fakeSpawn = (() => child) as typeof spawn;
  const app = agent({ name: 'test-agent' });
  app.onRequest(methods.agent.initialize, ({ params }) => {
    controls.initialize(params);
    return {
      protocolVersion: PROTOCOL_VERSION,
      info: { name: 'test-agent', version: '1.0.0' },
      capabilities,
      ...(browserAuth
        ? { authMethods: [{ methodId: 'web', name: 'Web sign-in', type: 'agent' as const }] }
        : {}),
    };
  });
  app.onRequest(methods.agent.session.new, ({ params }) => {
    controls.newSession(params);
    return { sessionId: 'v2-session', configOptions, availableCommands };
  });
  app.onRequest(methods.agent.session.prompt, async ({ params, client, requestId }) => {
    controls.prompt(params);
    if (elicitation) {
      const request =
        typeof elicitation === 'function' ? elicitation(requestId ?? -1) : elicitation;
      const result = await client.request(methods.client.elicitation.create, request);
      controls.elicitation(result);
      if (request.mode === 'url') {
        await client.notify(methods.client.elicitation.complete, {
          elicitationId: String(request.elicitationId),
        });
      }
    }
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        name: 'read_file',
        kind: 'read',
        locations: [{ path: '/tmp/example.ts' }],
      },
    });
    const outcome = await client.request(methods.client.session.requestPermission, {
      sessionId: params.sessionId,
      title: 'Read example file',
      subject: {
        type: 'tool_call',
        toolCall: { toolCallId: 'tool-1' },
      },
      options: [
        { optionId: 'always', name: 'Allow permanently', kind: 'allow_always' },
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    });
    controls.permission(outcome);
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
      update: stopReason
        ? { sessionUpdate: 'state_update', state: 'idle', stopReason }
        : { sessionUpdate: 'state_update', state: 'idle', stopReason: null },
    });
    return { messageId: 'message-1' };
  });
  app.onRequest(methods.agent.session.close, () => ({}));
  app.onRequest(methods.agent.session.resume, ({ params }) => {
    controls.resume(params);
    return { configOptions: [], availableCommands };
  });
  app.onRequest(methods.agent.session.fork, ({ params }) => {
    controls.fork(params);
    return { sessionId: 'v2-fork', configOptions: [], availableCommands };
  });
  app.onNotification(methods.agent.session.cancel, ({ params }) => {
    controls.cancel(params);
  });
  app.onRequest(methods.agent.session.setConfigOption, ({ params }) => {
    controls.setConfigOption(params);
    return { configOptions };
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
  app.onRequest(methods.agent.auth.login, async ({ params, client }) => {
    controls.login(params);
    if (browserAuth) {
      const consent = await client.request(methods.client.elicitation.create, {
        mode: 'url',
        url: 'https://example.com/login',
        elicitationId: 'login-url',
        message: 'Sign in',
        requestId: 1,
      });
      if (consent.action !== 'accept') throw new Error('Browser sign-in declined');
    }
    return {};
  });
  const agentConnection = app.connect(ndJsonStream(agentToClient.writable, clientToAgent.readable));
  return { transport, fakeSpawn, agentConnection, wasKilled: () => killed, controls };
}

describe('AcpV2AgentDriver', () => {
  test('forwards traceparent metadata across the v2 protocol without baggage or extra fields', async () => {
    const traceparent = '00-22222222222222222222222222222222-2222222222222222-00';
    const active = vi
      .spyOn(telemetryContext, 'active')
      .mockReturnValue(restoreTraceContext(traceparent));
    const setup = harness();
    const driver = new AcpV2AgentDriver(setup.fakeSpawn, undefined, () => setup.transport);
    try {
      const session = await driver.startSession(
        'agent',
        [],
        {
          cwd: '/tmp',
          features: EMPTY_AGENT_FEATURES,
          intent: { kind: 'new' },
        },
        { onUpdate() {}, onRequestPermission: async () => ({ allowed: false }) },
      );
      try {
        await session.prompt('private prompt');
        expect(setup.controls.prompt).toHaveBeenCalledWith(
          expect.objectContaining({ _meta: { traceparent } }),
        );
      } finally {
        await session.close();
      }
    } finally {
      setup.agentConnection.close();
      active.mockRestore();
    }
  });

  test.each(['new', 'resume', 'fork'] as const)(
    'publishes command snapshots from %s setup, including an empty list',
    async (kind) => {
      for (const commands of [
        [
          {
            name: 'review',
            description: 'Review changes',
            input: { type: 'text' as const, hint: 'Scope' },
          },
        ],
        [],
      ]) {
        const setup = harness([], false, false, undefined, undefined, 'end_turn', commands);
        const events: AgentUpdate[] = [];
        const driver = new AcpV2AgentDriver(setup.fakeSpawn, undefined, () => setup.transport);
        const session = await driver.startSession(
          'agent',
          [],
          {
            cwd: '/tmp',
            features: EMPTY_AGENT_FEATURES,
            intent: kind === 'new' ? { kind } : { kind, sessionId: 'source-session' },
          },
          {
            onUpdate: (event) => {
              events.push(event);
            },
            onRequestPermission: async () => ({ allowed: false }),
          },
        );
        try {
          expect(events).toContainEqual({
            type: 'available_commands_update',
            commands: commands.map((command) => ({
              name: command.name,
              description: command.description,
              input: { hint: command.input.hint },
            })),
          });
        } finally {
          await session.close();
          setup.agentConnection.close();
        }
      }
    },
  );

  test('routes SDK-native child messages and state snapshots without ending the root turn', async () => {
    const setup = harness();
    const events: AgentUpdate[] = [];
    const driver = new AcpV2AgentDriver(setup.fakeSpawn, undefined, () => setup.transport);
    const session = await driver.startSession(
      'agent',
      [],
      {
        cwd: '/tmp',
        features: EMPTY_AGENT_FEATURES,
        intent: { kind: 'new' },
      },
      {
        onUpdate: (event) => {
          events.push(event);
        },
        onRequestPermission: async () => ({ allowed: false }),
      },
    );
    try {
      await setup.agentConnection.client.notify(methods.client.session.update, {
        sessionId: session.id!,
        update: {
          sessionUpdate: 'subagent_update',
          sessionId: 'child',
          capabilities: { cancel: {} },
          state: { state: 'running' },
        },
      });
      await setup.agentConnection.client.notify(methods.client.session.update, {
        sessionId: session.id!,
        update: {
          sessionUpdate: 'session_message_chunk',
          messageId: 'directed',
          senderSessionId: session.id!,
          recipientSessionId: 'child',
          content: { type: 'text', text: 'Investigate' },
        },
      });
      await setup.agentConnection.client.notify(methods.client.session.update, {
        sessionId: 'child',
        update: { sessionUpdate: 'state_update', state: 'unknown' },
      });
      await vi.waitFor(() =>
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'subagent_update',
            association: expect.objectContaining({
              subagentId: 'child',
              state: { state: 'unknown' },
            }),
          }),
        ),
      );
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'session_message', content: 'Investigate' }),
      );
      expect(await session.prompt('Continue')).toMatchObject({ stopReason: 'end_turn' });
    } finally {
      await session.close();
      setup.agentConnection.close();
    }
  });

  test('applies initial selections and live controls through advertised config IDs', async () => {
    const setup = harness([
      {
        configId: 'preferred_llm',
        category: 'model',
        name: 'Model',
        type: 'select',
        currentValue: 'first',
        options: [
          { value: 'first', name: 'First' },
          { value: 'second', name: 'Second' },
        ],
      },
      {
        configId: 'reasoning_budget',
        category: 'thought_level',
        name: 'Reasoning',
        type: 'select',
        currentValue: 'low',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'high', name: 'High' },
        ],
      },
      {
        configId: 'tool_policy',
        category: 'mode',
        name: 'Mode',
        type: 'select',
        currentValue: 'plan',
        options: [
          { value: 'plan', name: 'Plan' },
          { value: 'code', name: 'Code' },
        ],
      },
    ]);
    const driver = new AcpV2AgentDriver(setup.fakeSpawn, undefined, () => setup.transport);
    const session = await driver.startSession(
      'agent',
      [],
      {
        cwd: '/tmp',
        features: EMPTY_AGENT_FEATURES,
        intent: { kind: 'new' },
        selectedModel: 'second',
        selectedThinkingEffort: 'high',
        resolvedModelConfigId: 'outdated_probe_id',
      },
      { onUpdate() {}, onRequestPermission: async () => ({ allowed: false }) },
    );
    try {
      expect(
        setup.controls.setConfigOption.mock.calls.map(([request]) => [
          request.configId,
          request.value,
        ]),
      ).toEqual([
        ['preferred_llm', 'second'],
        ['reasoning_budget', 'high'],
      ]);
      await session.updateModel?.('first');
      await session.setMode?.('code');
      expect(setup.controls.setConfigOption).toHaveBeenLastCalledWith(
        expect.objectContaining({ configId: 'tool_policy', value: 'code' }),
      );
      expect(session.availableModes).toEqual(['plan', 'code']);
    } finally {
      await session.close();
      setup.agentConnection.close();
    }
  });
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
    const setup = harness([
      {
        configId: 'mode',
        category: 'mode',
        name: 'Mode',
        type: 'select',
        currentValue: 'code',
        options: [{ value: 'code', name: 'Code' }],
      },
    ]);
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
    expect(report.promptResult).toMatchObject({
      stopReason: 'end_turn',
      userMessageId: 'message-1',
    });
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
        toolCall: expect.objectContaining({
          name: 'read_file',
          toolCallId: 'tool-1',
          kind: 'read',
          locations: [{ path: '/tmp/example.ts', line: undefined }],
        }),
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

test('provider probe cleanup consumes the exit rejection from a terminated control process', async () => {
  const h = harness([], true);
  const driver = new AcpV2AgentDriver(h.fakeSpawn, undefined, () => h.transport);
  try {
    expect((await driver.inspectProvider('agent', [])).status).toBe('ready');
    expect(h.wasKilled()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    h.agentConnection.close();
  }
});

test('ACP v2 browser authentication waits for client consent', async () => {
  const setup = harness([], false, true);
  const driver = new AcpV2AgentDriver(setup.fakeSpawn, undefined, () => setup.transport);
  let accept!: (accepted: boolean) => void;
  let displayed!: () => void;
  const shown = new Promise<void>((resolve) => {
    displayed = resolve;
  });
  let finished = false;
  const login = driver
    .authenticateProvider('agent', [], {}, 'web', {
      onBrowserRequest: (request) => {
        expect(request.url).toBe('https://example.com/login');
        displayed();
        return new Promise<boolean>((resolve) => {
          accept = resolve;
        });
      },
    })
    .then(() => {
      finished = true;
    });
  await shown;
  expect(finished).toBe(false);
  accept(true);
  await login;
  expect(setup.wasKilled()).toBe(true);
  setup.agentConnection.close();
});

test.each([
  [{ allowed: true }, { outcome: 'selected', optionId: 'allow' }],
  [{ allowed: false, cancelled: true }, { outcome: 'cancelled' }],
])('v2 selects once options and preserves cancellation', async (response, expected) => {
  const setup = harness();
  const driver = new AcpV2AgentDriver(setup.fakeSpawn, undefined, () => setup.transport);
  const session = await driver.startSession(
    'agent',
    [],
    { cwd: '/tmp', features: EMPTY_AGENT_FEATURES, intent: { kind: 'new' } },
    { onUpdate() {}, onRequestPermission: async () => response },
  );
  try {
    await session.prompt('hello');
    expect(setup.controls.permission).toHaveBeenCalledWith({ outcome: expected });
  } finally {
    await session.close();
    setup.agentConnection.close();
  }
});

describe('v2 session elicitation', () => {
  const form = (
    scope: { sessionId: string } | { requestId: string | number },
  ): CreateElicitationRequest => ({
    ...scope,
    mode: 'form',
    message: 'Choose a name',
    requestedSchema: {
      type: 'object',
      properties: { name: { type: 'string', pattern: '^[A-Z]+$' } },
      required: ['name'],
    },
  });
  test.each(['session', 'request'] as const)(
    'routes a %s scoped form through the runtime callback',
    async (scope) => {
      const setup = harness(
        [],
        false,
        false,
        scope === 'session'
          ? form({ sessionId: 'v2-session' })
          : (requestId) => form({ requestId }),
      );
      const onRequestElicitation = vi.fn(async () => ({
        action: 'submit' as const,
        values: { name: 'YES', ignored: 'drop' },
      }));
      const driver = new AcpV2AgentDriver(setup.fakeSpawn, undefined, () => setup.transport);
      const session = await driver.startSession(
        'agent',
        [],
        {
          localSessionId: 'local',
          cwd: '/tmp',
          env: {},
          intent: { kind: 'new' },
          features: EMPTY_AGENT_FEATURES,
        },
        {
          onUpdate() {},
          onRequestPermission: async () => ({ allowed: false }),
          onRequestElicitation,
        },
      );
      try {
        await session.prompt('Ask for input');
        expect(setup.controls.initialize).toHaveBeenCalledWith(
          expect.objectContaining({
            capabilities: expect.objectContaining({ elicitation: { form: {}, url: {} } }),
          }),
        );
        expect(onRequestElicitation).toHaveBeenCalledWith(
          expect.objectContaining({ mode: 'form' }),
          expect.any(AbortSignal),
        );
        expect(setup.controls.elicitation).toHaveBeenCalledWith({
          action: 'accept',
          content: { name: 'YES' },
        });
      } finally {
        await session.close();
        setup.agentConnection.close();
      }
    },
  );

  test('declines an unrelated request scope without prompting the user', async () => {
    const setup = harness([], false, false, form({ requestId: 'unrelated' }));
    const onRequestElicitation = vi.fn(async () => ({ action: 'cancel' as const }));
    const driver = new AcpV2AgentDriver(setup.fakeSpawn, undefined, () => setup.transport);
    const session = await driver.startSession(
      'agent',
      [],
      {
        localSessionId: 'local',
        cwd: '/tmp',
        env: {},
        intent: { kind: 'new' },
        features: EMPTY_AGENT_FEATURES,
      },
      {
        onUpdate() {},
        onRequestPermission: async () => ({ allowed: false }),
        onRequestElicitation,
      },
    );
    try {
      await session.prompt('Ask for input');
      expect(onRequestElicitation).not.toHaveBeenCalled();
      expect(setup.controls.elicitation).toHaveBeenCalledWith({ action: 'decline' });
    } finally {
      await session.close();
      setup.agentConnection.close();
    }
  });

  test('routes URL completion back to the requesting session', async () => {
    const setup = harness([], false, false, {
      sessionId: 'v2-session',
      mode: 'url',
      message: 'Continue in browser',
      url: 'https://example.com/flow',
      elicitationId: 'url-1',
    });
    const onElicitationCompleted = vi.fn();
    const driver = new AcpV2AgentDriver(setup.fakeSpawn, undefined, () => setup.transport);
    const session = await driver.startSession(
      'agent',
      [],
      {
        localSessionId: 'local',
        cwd: '/tmp',
        env: {},
        intent: { kind: 'new' },
        features: EMPTY_AGENT_FEATURES,
      },
      {
        onUpdate() {},
        onRequestPermission: async () => ({ allowed: false }),
        onRequestElicitation: async () => ({ action: 'submit' }),
        onElicitationCompleted,
      },
    );
    try {
      await session.prompt('Open flow');
      expect(onElicitationCompleted).toHaveBeenCalledWith('url-1');
    } finally {
      await session.close();
      setup.agentConnection.close();
    }
  });
});

test('v2 keeps MCP transports distinct and sends only advertised transport types', async () => {
  const setup = harness([], false, false, undefined, { session: { mcp: { http: {}, stdio: {} } } });
  const driver = new AcpV2AgentDriver(setup.fakeSpawn, undefined, () => setup.transport);
  const session = await driver.startSession(
    'agent',
    [],
    {
      cwd: '/tmp',
      features: EMPTY_AGENT_FEATURES,
      intent: { kind: 'new' },
      mcpServers: [
        { type: 'http', name: 'http', url: 'https://example.com/mcp', headers: [] },
        { type: 'sse', name: 'sse', url: 'https://example.com/sse', headers: [] },
        { name: 'stdio', command: 'unused', args: [], env: [] },
      ],
    },
    { onUpdate() {}, onRequestPermission: async () => ({ allowed: false }) },
  );
  try {
    expect(setup.controls.newSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServers: [
          { type: 'http', name: 'http', url: 'https://example.com/mcp', headers: [] },
          { type: 'stdio', name: 'stdio', command: 'unused', args: [], env: [] },
        ],
      }),
    );
    await expect(session.setMode?.('invented')).rejects.toThrow('did not advertise');
  } finally {
    await session.close();
    setup.agentConnection.close();
  }
});

test.each(['tool_call', 'status'] as const)(
  'v2 does not report success after a %s update failed to persist',
  async (failedType) => {
    const setup = harness();
    const driver = new AcpV2AgentDriver(setup.fakeSpawn, undefined, () => setup.transport);
    const session = await driver.startSession(
      'agent',
      [],
      { cwd: '/tmp', features: EMPTY_AGENT_FEATURES, intent: { kind: 'new' } },
      {
        onRequestPermission: async () => ({ allowed: false }),
        onUpdate(event) {
          if (event.type === failedType) throw new Error('persistence failed');
        },
      },
    );
    try {
      await expect(session.prompt('hello')).rejects.toThrow('persistence failed');
    } finally {
      await session.close();
      setup.agentConnection.close();
    }
  },
);

test('v2 rejects foreground completion without a stop reason', async () => {
  const setup = harness([], false, false, undefined, undefined, null);
  const driver = new AcpV2AgentDriver(setup.fakeSpawn, undefined, () => setup.transport);
  const session = await driver.startSession(
    'agent',
    [],
    { cwd: '/tmp', features: EMPTY_AGENT_FEATURES, intent: { kind: 'new' } },
    { onUpdate() {}, onRequestPermission: async () => ({ allowed: false }) },
  );
  try {
    await expect(session.prompt('hello')).rejects.toThrow('without a stop reason');
  } finally {
    await session.close();
    setup.agentConnection.close();
  }
});

test('v2 clears persistence errors after a rejected prompt before the next turn', async () => {
  const setup = harness();
  const driver = new AcpV2AgentDriver(setup.fakeSpawn, undefined, () => setup.transport);
  let firstUpdate = true;
  let firstPermission = true;
  const session = await driver.startSession(
    'agent',
    [],
    { cwd: '/tmp', features: EMPTY_AGENT_FEATURES, intent: { kind: 'new' } },
    {
      onUpdate(event) {
        if (event.type === 'tool_call' && firstUpdate) {
          firstUpdate = false;
          throw new Error('storage failed');
        }
      },
      async onRequestPermission() {
        if (firstPermission) {
          firstPermission = false;
          throw new Error('request failed');
        }
        return { allowed: false };
      },
    },
  );
  try {
    await expect(session.prompt('first')).rejects.toMatchObject({ code: -32603 });
    await expect(session.prompt('second')).resolves.toMatchObject({ stopReason: 'end_turn' });
  } finally {
    await session.close();
    setup.agentConnection.close();
  }
});

test.each(['permission', 'form'] as const)(
  'v2 responds to %s cancellation while its consent callback stays pending',
  async (kind) => {
    const setup = harness();
    const driver = new AcpV2AgentDriver(setup.fakeSpawn, undefined, () => setup.transport);
    const consent = vi.fn(() => new Promise<never>(() => {}));
    const session = await driver.startSession(
      'agent',
      [],
      { cwd: '/tmp', features: EMPTY_AGENT_FEATURES, intent: { kind: 'new' } },
      { onUpdate() {}, onRequestPermission: consent, onRequestElicitation: consent },
    );
    try {
      const abort = new AbortController();
      const pending =
        kind === 'permission'
          ? setup.agentConnection.client.request(
              methods.client.session.requestPermission,
              {
                sessionId: 'v2-session',
                title: 'Consent',
                options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
              },
              { cancellationSignal: abort.signal },
            )
          : setup.agentConnection.client.request(
              methods.client.elicitation.create,
              {
                sessionId: 'v2-session',
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
      await session.close();
      setup.agentConnection.close();
    }
  },
);
