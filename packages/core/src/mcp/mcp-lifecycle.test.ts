import { expect, test, vi } from 'vitest';
import { createDatabase, mcpServers } from '../db/index.js';
import { noopLogger } from '../logger.js';
import { McpGateway } from './mcp-gateway.js';
import type { McpConnection, McpConnectionFactory } from './mcp-connection.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function peer() {
  const connection = {
    connect: vi.fn(async (): Promise<void> => undefined),
    close: vi.fn(async (): Promise<void> => undefined),
    listTools: vi.fn(async () => ({
      tools: [{ name: 'echo', inputSchema: { type: 'object' as const } }],
    })),
    callTool: vi.fn(async () => ({ content: [] })),
  } satisfies McpConnection;
  return connection;
}
function gateway(create: McpConnectionFactory, type = 'local') {
  const db = createDatabase(':memory:');
  db.insert(mcpServers)
    .values({
      id: 'server',
      name: 'Test',
      type,
      command: 'test-peer',
      url: type === 'remote' ? 'https://example.invalid/mcp' : null,
    })
    .run();
  return new McpGateway(db, noopLogger, create);
}

test('concurrent startup shares one handshake, and repeated startup reuses the connection', async () => {
  const connection = peer();
  const create = vi.fn(() => connection);
  const service = gateway(create);
  await Promise.all([service.start(), service.start()]);
  await service.start();
  expect(create).toHaveBeenCalledOnce();
  expect((await service.getTools())[0]?.name).toBe('server__echo');
  await service.stop();
  expect(connection.close).toHaveBeenCalledOnce();
});

test('stop closes an in-flight handshake and prevents late publication', async () => {
  const connection = peer();
  const handshake = deferred();
  connection.connect.mockImplementation(() => handshake.promise);
  const service = gateway(() => connection);
  const startup = service.start();
  await vi.waitFor(() => expect(connection.connect).toHaveBeenCalledOnce());
  const stopped = service.stop();
  await vi.waitFor(() => expect(connection.close).toHaveBeenCalledOnce());
  handshake.resolve();
  await Promise.all([startup, stopped]);
  expect(service.isServerConnected('server')).toBe(false);
  expect(service.getConnectionError('server')).toBeUndefined();
  await expect(service.callTool('server', 'echo', {})).rejects.toThrow('stopped');
});

test('an old close callback cannot retire a replacement after reload', async () => {
  const first = peer();
  const replacement = peer();
  const create = vi.fn().mockReturnValueOnce(first).mockReturnValue(replacement);
  const service = gateway(create);
  await service.start();
  const staleClose = (first as McpConnection).onclose!;
  await service.reload();
  staleClose();
  expect(service.isServerConnected('server')).toBe(true);
  expect((await service.getTools())[0]?.name).toBe('server__echo');
  expect(replacement.close).not.toHaveBeenCalled();
  await service.stop();
});

test('failed handshakes always close the client and preserve the startup error', async () => {
  const connection = peer();
  connection.connect.mockRejectedValue(new Error('handshake rejected'));
  const service = gateway(() => connection);
  await service.start();
  expect(connection.close).toHaveBeenCalledOnce();
  expect(service.getConnectionError('server')).toBe('handshake rejected');
  await service.stop();
});

test('stop owns stateless tool calls and waits for their cancellation to settle', async () => {
  const connection = peer();
  const tool = deferred<{ content: [] }>();
  connection.callTool.mockImplementation(() => tool.promise);
  const service = gateway(() => connection, 'remote');
  const call = service.callTool('server', 'echo', {});
  const rejected = expect(call).rejects.toThrow('stopped');
  await vi.waitFor(() => expect(connection.callTool).toHaveBeenCalledOnce());
  let finished = false;
  const stopped = service.stop().then(() => {
    finished = true;
  });
  await vi.waitFor(() => expect(connection.close).toHaveBeenCalledOnce());
  expect(finished).toBe(false);
  tool.resolve({ content: [] });
  await Promise.all([rejected, stopped]);
  expect(connection.close).toHaveBeenCalledOnce();
});

test('an external stop during reload prevents the reload from restarting resources', async () => {
  const connection = peer();
  const closing = deferred();
  connection.close.mockImplementation(() => closing.promise);
  const create = vi.fn(() => connection);
  const service = gateway(create);
  await service.start();
  const reload = service.reload();
  const stop = service.stop();
  closing.resolve();
  await Promise.all([reload, stop]);
  expect(create).toHaveBeenCalledOnce();
  expect(service.isServerConnected('server')).toBe(false);
});
