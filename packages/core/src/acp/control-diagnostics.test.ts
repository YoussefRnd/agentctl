import {
  agent as v1Agent,
  methods as v1Methods,
  ndJsonStream as v1Stream,
  PROTOCOL_VERSION as V1,
} from '@agentclientprotocol/sdk';
import {
  agent as v2Agent,
  methods as v2Methods,
  ndJsonStream as v2Stream,
  PROTOCOL_VERSION as V2,
} from '@agentclientprotocol/sdk/experimental/v2';
import type { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { diagnosticError } from '../agent/operation-diagnostics.js';
import { noopLogger } from '../logger.js';
import type { AgentStreamTransport } from './types.js';
import { AcpV1ProviderControls } from './v1/control.js';
import { AcpV2ProviderControls } from './v2/control.js';

afterEach(() => vi.unstubAllEnvs());

test.each([
  ['v1', 'initializing'],
  ['v1', 'opening-session'],
  ['v2', 'initializing'],
  ['v2', 'opening-session'],
] as const)('%s probe diagnostics identify a timeout during %s', async (version, failingStage) => {
  vi.stubEnv('AGENTCTL_AGENT_REQUEST_TIMEOUT_MS', '100');
  const toAgent = new TransformStream<Uint8Array>();
  const toClient = new TransformStream<Uint8Array>();
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stderr,
    pid: 1234,
    exitCode: null,
    signalCode: null,
  }) as unknown as ChildProcess;
  const transport: AgentStreamTransport = {
    stdin: toAgent.writable,
    stdout: toClient.readable,
    closed: new Promise(() => {}),
    child,
    isAlive: true,
    kill: vi.fn(),
  };
  const spawnImpl = (() => child) as typeof spawn;
  const hang = () => new Promise<never>(() => {});
  let inspect: () => Promise<unknown>;
  let close: () => void;
  if (version === 'v1') {
    const app = v1Agent();
    app.onRequest(v1Methods.agent.initialize, () =>
      failingStage === 'initializing' ? hang() : { protocolVersion: V1, agentCapabilities: {} },
    );
    app.onRequest(v1Methods.agent.session.new, hang);
    const peer = app.connect(v1Stream(toClient.writable, toAgent.readable));
    close = () => peer.close();
    const controls = new AcpV1ProviderControls(spawnImpl, noopLogger, () => transport, {
      get: async () => null,
      set: async () => {},
    });
    inspect = () => controls.inspectProvider('test-agent', []);
  } else {
    const app = v2Agent({ name: 'test' });
    app.onRequest(v2Methods.agent.initialize, () =>
      failingStage === 'initializing'
        ? hang()
        : {
            protocolVersion: V2,
            info: { name: 'test', version: '1.0.0' },
            capabilities: { session: {} },
          },
    );
    app.onRequest(v2Methods.agent.session.new, hang);
    const peer = app.connect(v2Stream(toClient.writable, toAgent.readable));
    close = () => peer.close();
    const controls = new AcpV2ProviderControls(spawnImpl, noopLogger, () => transport);
    inspect = () => controls.inspectProvider('test-agent', []);
  }
  try {
    const failure = await inspect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(diagnosticError(failure)).toMatchObject({
      processPid: 1234,
      operationDiagnostics: { outcome: 'error', failedStage: failingStage },
    });
    expect(transport.kill).toHaveBeenCalledOnce();
  } finally {
    close();
    stderr.destroy();
  }
});
