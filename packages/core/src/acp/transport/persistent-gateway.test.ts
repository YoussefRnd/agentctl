import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { expect, test, vi } from 'vite-plus/test';
import { EMPTY_AGENT_FEATURES } from '@agentctl/shared';
import { AcpV1AgentDriver } from '../v1/driver.js';
import { PersistentAgentConnectionManager } from './persistent-connection.js';

test('persistent sessions retain the requested MCP gateway and its permission policy', async () => {
  const id = 'fixture';
  const row = { id, command: process.execPath, registryAgentId: id };
  const launch = {
    command: process.execPath,
    args: [fileURLToPath(new URL('../testing/smoke-peer.mjs', import.meta.url)), '--gateway'],
    env: {},
  };
  const registry = {
    version: 'fixture',
    agents: [
      {
        id,
        name: id,
        version: '1.0.0',
        description: 'Local test peer',
        authors: [],
        distribution: { npx: { package: 'fixture' } },
      },
    ],
  };
  const manager = new PersistentAgentConnectionManager(
    { get: () => row, listAll: () => [row] } as never,
    { getSnapshot: () => ({ data: JSON.stringify(registry) }) } as never,
    { resolveLaunch: () => launch } as never,
  );
  const runtime = new AcpV1AgentDriver();
  runtime.setConnectionManager(manager);
  const gateway = {
    getTools: vi.fn(async () => [{ name: 'test__echo' }]),
    callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'example' }] })),
  };
  const permission = vi.fn(async () => ({ allowed: true }));
  try {
    const initializing = manager.getConnection(id, { mcpGateway: gateway });
    const differentGateway = expect(
      manager.getConnection(id, { mcpGateway: { ...gateway } }),
    ).rejects.toThrow('different MCP gateway');
    await initializing;
    await differentGateway;
    await expect(manager.getConnection(id)).rejects.toThrow('different MCP gateway');
    const session = await runtime.startSession(
      launch.command,
      launch.args,
      {
        providerId: id,
        cwd: tmpdir(),
        features: EMPTY_AGENT_FEATURES,
        intent: { kind: 'new' },
        mcpGateway: gateway,
      },
      { onUpdate() {}, onRequestPermission: permission },
    );
    await expect(session.prompt('Exercise the fixture gateway')).resolves.toMatchObject({
      stopReason: 'end_turn',
    });
    expect(gateway.callTool).toHaveBeenCalledExactlyOnceWith('test', 'echo', { text: 'example' });
    expect(permission).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'client',
        toolCall: expect.objectContaining({ name: 'test__echo' }),
      }),
      expect.any(AbortSignal),
    );
    expect(manager.getConnectionDiagnostics()).toMatchObject([{ activeSessionCount: 1 }]);
    await session.close();
    expect(manager.getConnectionDiagnostics()).toMatchObject([{ activeSessionCount: 0 }]);
  } finally {
    manager.closeAll();
  }
});
