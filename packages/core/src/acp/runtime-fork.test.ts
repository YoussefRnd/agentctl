import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vitest';
import type { ClientSideConnection } from '@agentclientprotocol/sdk';
import { EMPTY_AGENT_FEATURES } from '@agentctl/shared';
import { AcpV1AgentDriver } from './runtime.js';
import { parseAcpCapabilities } from './transport/capabilities-cache.js';
import type { AgentStreamTransport, IConnectionManager } from './types.js';
import { runAgentDriverConformance } from '../agent/conformance.js';

function setup(supported = true, extraSessionCapabilities: Record<string, unknown> = {}) {
  const closed = new Promise<void>(() => {});
  const connection = {
    closed,
    request: vi.fn().mockResolvedValue({}),
    unstable_forkSession: vi.fn().mockResolvedValue({ sessionId: 'forked-agent-id' }),
    newSession: vi.fn().mockResolvedValue({ sessionId: 'fresh-agent-id' }),
    prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn' }),
    cancel: vi.fn().mockResolvedValue({}),
    setSessionConfigOption: vi.fn().mockResolvedValue({ configOptions: [] }),
    setSessionMode: vi.fn().mockResolvedValue({}),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    deleteSession: vi.fn().mockResolvedValue({}),
    logout: vi.fn().mockResolvedValue({}),
    authenticate: vi.fn().mockResolvedValue({}),
    resumeSession: vi.fn().mockResolvedValue({ sessionId: 'source-agent-id' }),
  };
  const manager: IConnectionManager = {
    getProviderIdByCommand: () => 'provider',
    getConnection: vi.fn().mockResolvedValue({
      child: new EventEmitter() as ChildProcess,
      transport: { closed, isAlive: true } as AgentStreamTransport,
      connection: connection as unknown as ClientSideConnection,
      capabilities: parseAcpCapabilities({
        sessionCapabilities: {
          fork: supported ? {} : undefined,
          list: {},
          delete: {},
          ...extraSessionCapabilities,
        },
      }),
    }),
    closeSession: vi.fn(),
    registerActiveSession: vi.fn(),
    unregisterActiveSession: vi.fn(),
    writeTerminalInput: () => false,
  };
  const runtime = new AcpV1AgentDriver();
  runtime.setConnectionManager(manager);
  const execute = () =>
    runtime.startSession(
      'agent',
      [],
      {
        providerId: 'provider',
        localSessionId: 'local-fork',
        cwd: '/tmp/destination-worktree',
        features: EMPTY_AGENT_FEATURES,
        intent: { kind: 'fork', sessionId: 'source-agent-id' },
        mcpServers: [],
      },
      { onUpdate() {}, onRequestPermission: async () => ({ allowed: false }) },
    );
  return { connection, manager, runtime, execute };
}

afterEach(() => vi.unstubAllEnvs());

test('v1 cancellation cancels pending approval callbacks without affecting a sibling session', async () => {
  const { runtime, manager, connection } = setup(false);
  const consent = vi.fn(() => new Promise<never>(() => {}));
  const sessions = [];
  const callbacks = [];
  for (const id of ['first', 'second']) {
    connection.newSession.mockResolvedValueOnce({ sessionId: id });
    sessions.push(
      await runtime.startSession(
        'agent',
        [],
        {
          providerId: 'provider',
          cwd: '/tmp',
          features: EMPTY_AGENT_FEATURES,
          intent: { kind: 'new' },
        },
        { onUpdate() {}, onRequestPermission: consent },
      ),
    );
    callbacks.push(vi.mocked(manager.registerActiveSession).mock.lastCall![1].callbacks);
  }
  const request = { permissionId: 'permission', toolCall: { name: 'tool' } };
  const first = callbacks[0].onRequestPermission(request);
  const second = callbacks[1].onRequestPermission(request);
  try {
    await sessions[0].cancel();
    expect(await first).toEqual({ allowed: false, cancelled: true });
    let siblingSettled = false;
    void second.then(() => {
      siblingSettled = true;
    });
    await Promise.resolve();
    expect(siblingSettled).toBe(false);
    await sessions[1].cancel();
    expect(await second).toEqual({ allowed: false, cancelled: true });
    expect(connection.cancel.mock.calls).toEqual([
      [{ sessionId: 'first' }],
      [{ sessionId: 'second' }],
    ]);
  } finally {
    await Promise.all(sessions.map((session) => session.close()));
  }
});

test('v1 startup and live model selection use categorized session options rather than stale probe IDs', async () => {
  const { runtime, connection } = setup(false);
  const configOptions = [
    {
      id: 'preferred_llm',
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
      id: 'reasoning_budget',
      category: 'thought_level',
      name: 'Reasoning',
      type: 'select',
      currentValue: 'low',
      options: [
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
      ],
    },
  ];
  connection.newSession.mockResolvedValue({ sessionId: 'fresh-agent-id', configOptions });
  connection.setSessionConfigOption.mockResolvedValue({ configOptions });
  const session = await runtime.startSession(
    'agent',
    [],
    {
      providerId: 'provider',
      cwd: '/tmp',
      intent: { kind: 'new' },
      features: { ...EMPTY_AGENT_FEATURES, configuration: { model: true, options: true } },
      selectedModel: 'second',
      selectedThinkingEffort: 'high',
      resolvedModelConfigId: 'old_model',
      resolvedThinkingConfigId: 'old_effort',
    },
    { onUpdate() {}, onRequestPermission: async () => ({ allowed: false }) },
  );
  try {
    expect(
      connection.setSessionConfigOption.mock.calls.map(([request]) => [
        request.configId,
        request.value,
      ]),
    ).toEqual([
      ['preferred_llm', 'second'],
      ['reasoning_budget', 'high'],
    ]);
    await session.updateModel?.('first');
    expect(connection.setSessionConfigOption).toHaveBeenLastCalledWith({
      sessionId: 'fresh-agent-id',
      configId: 'preferred_llm',
      value: 'first',
    });
  } finally {
    await session.close();
  }
});

test('v1 adapter passes the shared driver lifecycle and control contract', async () => {
  const { runtime, connection } = setup(false);
  const report = await runAgentDriverConformance(
    runtime,
    {
      providerId: 'provider',
      localSessionId: 'local-conformance',
      cwd: '/tmp/conformance',
      features: EMPTY_AGENT_FEATURES,
      intent: { kind: 'new' },
      mcpServers: [],
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
  expect(report).toMatchObject({
    sessionId: 'fresh-agent-id',
    history: 'fresh',
    promptResult: { stopReason: 'end_turn' },
    exercisedOperations: [
      'prompt',
      'cancel',
      'authenticate',
      'update_model',
      'update_config',
      'set_mode',
      'list_sessions',
      'delete_session',
      'logout',
    ],
  });
  expect(connection.cancel).toHaveBeenCalled();
  expect(connection.authenticate).toHaveBeenCalledWith({ methodId: 'oauth' });
  expect(connection.setSessionConfigOption).toHaveBeenCalledTimes(2);
  expect(connection.setSessionMode).toHaveBeenCalled();
  expect(connection.listSessions).toHaveBeenCalled();
  expect(connection.deleteSession).toHaveBeenCalled();
  expect(connection.logout).toHaveBeenCalled();
});

test('v1 adapter resumes an advertised provider session', async () => {
  const { runtime, connection } = setup(false, { resume: {} });
  const report = await runAgentDriverConformance(runtime, {
    providerId: 'provider',
    localSessionId: 'local-resume',
    cwd: '/tmp/conformance',
    features: EMPTY_AGENT_FEATURES,
    intent: { kind: 'resume', sessionId: 'source-agent-id' },
    mcpServers: [],
  });
  expect(report.history).toBe('restored');
  expect(connection.resumeSession).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: 'source-agent-id' }),
  );
});

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
test('v1 startup adopts model-specific config options and skips an unavailable effort', async () => {
  const { connection, runtime } = setup(false);
  const modelOption = {
    id: 'model',
    name: 'Model',
    type: 'select',
    currentValue: 'default-model',
    options: [
      { value: 'default-model', name: 'Default model' },
      { value: 'glm', name: 'GLM' },
    ],
  };
  const effortOption = {
    id: 'effort',
    name: 'Thinking Effort',
    category: 'thought_level',
    type: 'select',
    currentValue: 'default',
    options: [
      { value: 'low', name: 'Low' },
      { value: 'default', name: 'Default' },
    ],
  };
  connection.newSession.mockResolvedValue({
    sessionId: 'fresh-agent-id',
    configOptions: [modelOption, effortOption],
  });
  connection.setSessionConfigOption.mockResolvedValueOnce({
    configOptions: [
      { ...modelOption, currentValue: 'glm' },
      { ...effortOption, options: [{ value: 'default', name: 'Default' }] },
    ],
  });

  const handle = await runtime.startSession(
    'agent',
    [],
    {
      providerId: 'provider',
      cwd: '/tmp',
      features: {
        ...EMPTY_AGENT_FEATURES,
        configuration: { model: true, options: true },
      },
      intent: { kind: 'new' },
      selectedModel: 'glm',
      selectedThinkingEffort: 'low',
      resolvedModelConfigId: 'model',
      resolvedThinkingConfigId: 'effort',
    },
    { onUpdate() {}, onRequestPermission: async () => ({ allowed: false }) },
  );

  expect(connection.setSessionConfigOption).toHaveBeenCalledExactlyOnceWith({
    sessionId: 'fresh-agent-id',
    configId: 'model',
    value: 'glm',
  });
  expect(handle.configOptions?.find((option) => option.id === 'effort')?.options).toEqual([
    { value: 'default', name: 'Default', description: undefined },
  ]);
  await handle.close();
});

test('strict native loading rejects unsupported loading without creating a replacement session', async () => {
  const { runtime, connection } = setup(false);
  await expect(
    runtime.startSession(
      'agent',
      [],
      {
        providerId: 'provider',
        cwd: '/tmp',
        features: EMPTY_AGENT_FEATURES,
        intent: { kind: 'resume', sessionId: 'native', requireExisting: true },
      },
      { onUpdate() {}, onRequestPermission: async () => ({ allowed: false }) },
    ),
  ).rejects.toThrow('does not support loading');
  expect(connection.newSession).not.toHaveBeenCalled();
});

test('strict native loading preserves session-not-found errors', async () => {
  const { runtime, connection } = setup(false, { resume: {} });
  connection.resumeSession.mockRejectedValue(new Error('Session not found'));
  await expect(
    runtime.startSession(
      'agent',
      [],
      {
        providerId: 'provider',
        cwd: '/tmp',
        features: EMPTY_AGENT_FEATURES,
        intent: { kind: 'resume', sessionId: 'native', requireExisting: true },
      },
      { onUpdate() {}, onRequestPermission: async () => ({ allowed: false }) },
    ),
  ).rejects.toThrow('Session not found');
  expect(connection.newSession).not.toHaveBeenCalled();
});

test('v1 honors the legacy ACP model capability on startup and live selection', async () => {
  const { runtime, connection } = setup(false);
  connection.newSession.mockResolvedValue({
    sessionId: 'legacy-session',
    models: {
      currentModelId: 'old',
      availableModels: [
        { modelId: 'old', name: 'Old' },
        { modelId: 'chosen', name: 'Chosen' },
      ],
    },
  });
  const session = await runtime.startSession(
    'agent',
    [],
    {
      providerId: 'provider',
      cwd: '/tmp',
      features: EMPTY_AGENT_FEATURES,
      intent: { kind: 'new' },
      selectedModel: 'chosen',
    },
    { onUpdate() {}, onRequestPermission: async () => ({ allowed: false }) },
  );
  try {
    expect(connection.request).toHaveBeenCalledWith('session/set_model', {
      sessionId: 'legacy-session',
      modelId: 'chosen',
    });
    expect(connection.setSessionConfigOption).not.toHaveBeenCalled();
    expect(session.configOptions?.find((option) => option.category === 'model')?.currentValue).toBe(
      'chosen',
    );
    await session.updateModel?.('old');
    expect(connection.request).toHaveBeenLastCalledWith('session/set_model', {
      sessionId: 'legacy-session',
      modelId: 'old',
    });
  } finally {
    await session.close();
  }
});
