import { EventEmitter } from 'node:events';
import type { ChildProcess, spawn } from 'node:child_process';
import { expect, test, vi } from 'vite-plus/test';
import type { AgentDriver } from '../agent/types.js';
import { AcpAgentDriver } from './driver.js';
import { AcpV2AgentDriver } from './v2/driver.js';
import type { AgentStreamTransport } from './types.js';
import { noopLogger } from '../logger.js';

test.each([1, 2])(
  'a v1-shaped wire response reporting version %s negotiates the v1 adapter',
  async (protocolVersion) => {
    const requests = new TransformStream<Uint8Array>();
    const responses = new TransformStream<Uint8Array>();
    const reader = requests.readable.getReader();
    const writer = responses.writable.getWriter();
    const child = new EventEmitter() as ChildProcess;
    const transport: AgentStreamTransport = {
      child,
      stdin: requests.writable,
      stdout: responses.readable,
      closed: new Promise<void>(() => {}),
      isAlive: true,
      kill: vi.fn(),
    };
    const v1: AgentDriver = {
      startSession: vi.fn(),
      inspectProvider: vi.fn().mockResolvedValue({
        status: 'ready',
        configOptions: [],
        authMethods: [],
        supportsDynamicModel: false,
        supportsDynamicConfig: false,
      }),
    };
    const v2 = new AcpV2AgentDriver((() => child) as typeof spawn, noopLogger, () => transport);
    const driver = new AcpAgentDriver(v1 as never, v2);
    const peer = reader.read().then(async ({ value }) => {
      const request = JSON.parse(new TextDecoder().decode(value)) as { id: number; method: string };
      expect(request.method).toBe('initialize');
      await writer.write(
        new TextEncoder().encode(
          JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: {
              protocolVersion,
              agentInfo: { name: 'legacy' },
              agentCapabilities: { loadSession: true },
            },
          }) + '\n',
        ),
      );
    });
    const result = await driver.inspectProvider('agent', [], {
      AGENTCTL_ACP_PROTOCOL: 'auto',
      AGENTCTL_ACP_V2_ENABLED: 'true',
    });
    await peer;
    expect(result.status).toBe('ready');
    expect(v1.inspectProvider).toHaveBeenCalledTimes(1);
    expect(transport.kill).toHaveBeenCalled();
    await reader.cancel();
    await writer.close().catch(() => undefined);
  },
);
