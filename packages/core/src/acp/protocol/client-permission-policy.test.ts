import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi, type Mock } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Client } from '@agentclientprotocol/sdk';
import { createDatabase } from '../../db/index.js';
import { projects, sessions, mcpServers } from '../../db/schema.js';
import { SessionRuntime } from '../../session/runtime/session-runtime.js';
import { SessionEventRepository } from '../../session/persistence/session-event-repository.js';
import type { AgentMcpGateway, AgentSession, AgentSessionCallbacks } from '../../agent/types.js';
import { createClientHandlers } from './client-handlers.js';
import { TerminalManager } from './terminal-manager.js';
import { noopLogger } from '../../logger.js';

let cwd: string;
let db: ReturnType<typeof createDatabase>;
let session: SessionRuntime;
let handlers: Required<Client>;
let manager: TerminalManager;
let callbacks: AgentSessionCallbacks;
let events: { id: number; data: string }[];
let waiting: ((event: { id: number; data: string }) => void) | undefined;
let gateway: {
  getTools: Mock<AgentMcpGateway['getTools']>;
  callTool: Mock<AgentMcpGateway['callTool']>;
};
const nextApproval = () =>
  new Promise<{ id: number; data: string }>((resolve) => {
    waiting = resolve;
  });
beforeEach(async () => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-client-policy-'));
  db = createDatabase(':memory:');
  await db.insert(projects).values({ id: 'project', name: 'Project', path: cwd });
  await db.insert(sessions).values({
    id: 'session',
    projectId: 'project',
    branch: 'main',
    worktreePath: cwd,
    taskSlug: 'test',
    agent: 'agent',
    selectedProvider: 'agent',
    baseCommit: 'hash',
    approvalMode: 'review',
  });
  events = [];
  waiting = undefined;
  const store = new SessionEventRepository(db, {
    publish(event: unknown) {
      const row = event as { id: number; type: string; data: string };
      if (row.type !== 'approval_request') return;
      events.push(row);
      if (JSON.parse(row.data).status === 'pending') {
        const notify = waiting;
        waiting = undefined;
        notify?.(row);
      }
    },
  });
  session = new SessionRuntime(
    'session',
    {
      id: 'native',
      history: 'fresh',
      closed: new Promise<void>(() => {}),
      onError() {},
      onClose() {},
      cancel: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as AgentSession,
    db,
    store,
    cwd,
  );
  callbacks = {
    onUpdate() {},
    onRequestPermission: (request) => session.handleRequestPermission(request),
  };
  manager = new TerminalManager(noopLogger);
  gateway = {
    getTools: vi.fn<AgentMcpGateway['getTools']>().mockResolvedValue([]),
    callTool: vi.fn<AgentMcpGateway['callTool']>().mockResolvedValue('done'),
  };
  handlers = createClientHandlers({
    cwd,
    terminalManager: manager,
    logger: noopLogger,
    mcpGateway: gateway,
    resolveSession: () => ({ callbacks, cwd }),
  }) as Required<Client>;
});
afterEach(async () => {
  await session.stop();
  await manager.dispose();
  fs.rmSync(cwd, { recursive: true, force: true });
});
async function respond(event: { id: number }, optionId: string) {
  // The event is published before append returns its ID to the waiting handler.
  await Promise.resolve();
  session.resolvePermission(String(event.id), { allowed: true, optionId });
}

test('a direct write cannot touch disk until the exact operation is approved', async () => {
  const pending = nextApproval();
  const write = handlers.writeTextFile({
    sessionId: 'native',
    path: path.join(cwd, 'new.ts'),
    content: 'hello',
  });
  const event = await pending;
  expect(fs.existsSync(path.join(cwd, 'new.ts'))).toBe(false);
  expect(JSON.parse(event.data).request).toMatchObject({
    source: 'client',
    toolCall: { kind: 'edit', locations: [{ path: path.join(cwd, 'new.ts') }] },
  });
  await respond(event, 'allow_once');
  await write;
  expect(fs.readFileSync(path.join(cwd, 'new.ts'), 'utf8')).toBe('hello');
  expect((await db.query.sessions.findFirst({ where: eq(sessions.id, 'session') }))?.status).toBe(
    'running',
  );
});
test('a direct write denied by the user never changes disk', async () => {
  const pending = nextApproval();
  const write = handlers.writeTextFile({
    sessionId: 'native',
    path: path.join(cwd, 'new.ts'),
    content: 'hello',
  });
  const rejected = expect(write).rejects.toThrow('Permission was not granted');
  await respond(await pending, 'reject_once');
  await rejected;
  expect(fs.existsSync(path.join(cwd, 'new.ts'))).toBe(false);
});
test('workspace edit mode approves direct writes, while blocked MCP tools stay blocked in every mode', async () => {
  await db.update(sessions).set({ approvalMode: 'auto_approve' }).where(eq(sessions.id, 'session'));
  await handlers.writeTextFile({
    sessionId: 'native',
    path: path.join(cwd, 'new.ts'),
    content: 'hello',
  });
  expect(events.every((event) => JSON.parse(event.data).status === 'approved')).toBe(true);
  await db
    .insert(mcpServers)
    .values({ id: 'tools', name: 'Tools', enabled: true, approvalPolicy: 'deny_all' });
  await db.update(sessions).set({ approvalMode: 'yolo' }).where(eq(sessions.id, 'session'));
  await expect(
    handlers.extMethod('_agentctl.dev/mcp/tools__blocked', { sessionId: 'native', value: 'x' }),
  ).rejects.toThrow('Permission was not granted');
  expect(gateway.callTool).not.toHaveBeenCalled();
});
test('terminal and bash requests cannot spawn a process before approval', async () => {
  const spawn = vi.spyOn(manager, 'spawn').mockReturnValue('fake-terminal');
  const pending = nextApproval();
  const terminal = handlers.createTerminal({
    sessionId: 'native',
    command: 'git',
    args: ['status'],
  });
  const rejected = expect(terminal).rejects.toThrow('Permission was not granted');
  const event = await pending;
  expect(spawn).not.toHaveBeenCalled();
  await respond(event, 'reject_once');
  await rejected;
  const next = nextApproval();
  const bash = handlers.extMethod('_agentctl.dev/builtin/bash', {
    sessionId: 'native',
    command: 'git',
    args: ['status'],
    pty: true,
  });
  const bashRejected = expect(bash).rejects.toThrow('Permission was not granted');
  await respond(await next, 'reject_once');
  await bashRejected;
  expect(spawn).not.toHaveBeenCalled();
});
test('one provider approval covers one matching client terminal, not a second launch', async () => {
  const spawn = vi.spyOn(manager, 'spawn').mockReturnValue('fake-terminal');
  const pending = nextApproval();
  const permission = session.handleRequestPermission({
    permissionId: 'provider',
    source: 'provider',
    toolCall: {
      name: 'arbitrary_shell',
      kind: 'execute',
      arguments: { command: 'git', args: ['status'], cwd },
    },
    options: [{ optionId: 'native-once', kind: 'allow_once' }],
  });
  await respond(await pending, 'native-once');
  await permission;
  await handlers.createTerminal({ sessionId: 'native', command: 'git', args: ['status'] });
  expect(spawn).toHaveBeenCalledTimes(1);
  const next = nextApproval();
  const second = handlers.createTerminal({ sessionId: 'native', command: 'git', args: ['status'] });
  const rejected = expect(second).rejects.toThrow('Permission was not granted');
  await respond(await next, 'reject_once');
  await rejected;
  expect(spawn).toHaveBeenCalledTimes(1);
});
test('cancelled consent cannot execute even if the stale approval is submitted', async () => {
  const pending = nextApproval();
  const write = handlers.writeTextFile({
    sessionId: 'native',
    path: path.join(cwd, 'new.ts'),
    content: 'hello',
  });
  const rejected = expect(write).rejects.toMatchObject({ code: -32800 });
  const event = await pending;
  await session.cancel();
  session.resolvePermission(String(event.id), { allowed: true, optionId: 'allow_once' });
  await rejected;
  expect(fs.existsSync(path.join(cwd, 'new.ts'))).toBe(false);
});

test('terminal input requires consent and a terminal owned by the requesting session', async () => {
  await db.update(sessions).set({ approvalMode: 'yolo' }).where(eq(sessions.id, 'session'));
  vi.spyOn(manager, 'spawn').mockReturnValue('fake-terminal');
  const write = vi.spyOn(manager, 'write').mockReturnValue(true);
  await handlers.createTerminal({ sessionId: 'native', command: 'bash' });
  await db.update(sessions).set({ approvalMode: 'review' }).where(eq(sessions.id, 'session'));
  const pending = nextApproval();
  const input = handlers.extMethod('_agentctl.dev/terminal/write', {
    sessionId: 'native',
    terminalId: 'fake-terminal',
    data: 'git push\n',
  });
  const rejected = expect(input).rejects.toThrow('Permission was not granted');
  const event = await pending;
  expect(write).not.toHaveBeenCalled();
  await respond(event, 'reject_once');
  await rejected;
  const other = createClientHandlers({
    cwd,
    terminalManager: manager,
    logger: noopLogger,
    resolveSession: () => ({ cwd, callbacks }),
  }) as Required<Client>;
  await expect(
    other.extMethod('_agentctl.dev/terminal/write', {
      sessionId: 'other',
      terminalId: 'fake-terminal',
      data: 'git push\n',
    }),
  ).rejects.toThrow('does not belong');
  expect(write).not.toHaveBeenCalled();
});

test('a deny rule added while consent is pending overrides the submitted approval', async () => {
  await db
    .insert(mcpServers)
    .values({ id: 'tools', name: 'Tools', enabled: true, approvalPolicy: 'always_prompt' });
  const pending = nextApproval();
  const call = handlers.extMethod('_agentctl.dev/mcp/tools__action', {
    sessionId: 'native',
    value: 'x',
  });
  const rejected = expect(call).rejects.toThrow('Permission was not granted');
  const event = await pending;
  await db.update(mcpServers).set({ approvalPolicy: 'deny_all' }).where(eq(mcpServers.id, 'tools'));
  await respond(event, 'allow_once');
  await rejected;
  expect(gateway.callTool).not.toHaveBeenCalled();
});
