import { test, describe, expect } from 'vitest';
import { ManagedSession } from './managed-session.js';
import { McpGateway } from '../mcp/mcp-gateway.js';
import { SessionEventStore } from './event-store.js';
import { createDatabase } from '../db/index.js';
import { projects, sessions, sessionEvents, mcpServers } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { AgentSession } from '../agent/types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const mcpServerScript = `
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  try {
    const req = JSON.parse(line);
    let res = { jsonrpc: '2.0', id: req.id };
    if (req.method === 'initialize') {
      res.result = {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'test-mcp-server',
          version: '1.0.0'
        }
      };
    } else if (req.method === 'tools/list') {
      res.result = {
        tools: [
          {
            name: 'calculate',
            description: 'Performs basic math',
            inputSchema: {
              type: 'object',
              properties: {
                format: { type: 'string' },
                expression: { type: 'string' }
              },
              required: ['expression']
            }
          },
          {
            name: 'fail',
            description: 'Always fails',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          }
        ]
      };
    } else if (req.method === 'tools/call') {
      if (req.params.name === 'calculate') {
        const expr = req.params.arguments?.expression;
        res.result = {
          content: [
            {
              type: 'text',
              text: \`result for \${expr}: 42\`
            }
          ]
        };
      } else if (req.params.name === 'fail') {
        res.error = { code: -32000, message: 'Simulated tool failure' };
      } else {
        res.error = { code: -32601, message: 'Method not found' };
      }
    } else {
      if (req.id === undefined) return;
      res.result = {};
    }
    process.stdout.write(JSON.stringify(res) + '\\n');
  } catch (err) {
    // ignore
  }
});
`;

describe('ManagedSession Manual MCP Tool Interceptor', () => {
  test('intercepts manual tool call, invokes via gateway, yields timeline, and forwards context to agent', async () => {
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `mock-session-mcp-server-${String(Date.now())}.js`);
    fs.writeFileSync(scriptPath, mcpServerScript, 'utf8');

    const db = createDatabase(':memory:');

    await db.insert(projects).values({
      id: 'proj-mcp',
      name: 'MCP Test Project',
      path: '/tmp/proj-mcp',
    });

    await db.insert(sessions).values([
      {
        id: 'sess-mcp',
        projectId: 'proj-mcp',
        branch: 'main',
        worktreePath: '/tmp/proj-mcp',
        taskSlug: 'test-mcp',
        agent: 'claude-acp',
        selectedProvider: 'claude-acp',
        baseCommit: 'hash',
      },
      {
        id: 'sess-mcp-fail',
        projectId: 'proj-mcp',
        branch: 'main',
        worktreePath: '/tmp/proj-mcp',
        taskSlug: 'test-mcp-fail',
        agent: 'claude-acp',
        selectedProvider: 'claude-acp',
        baseCommit: 'hash',
      },
      {
        id: 'sess-mcp-bypass',
        projectId: 'proj-mcp',
        branch: 'main',
        worktreePath: '/tmp/proj-mcp',
        taskSlug: 'test-mcp-bypass',
        agent: 'claude-acp',
        selectedProvider: 'claude-acp',
        baseCommit: 'hash',
      },
    ]);

    await db.insert(mcpServers).values({
      id: 'mock-calc',
      name: 'Calculator Server',
      command: 'node',
      launchArgs: JSON.stringify([scriptPath]),
      launchEnv: '{}',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const publishedEvents: unknown[] = [];
    const eventBus = {
      publish: (evt: unknown) => {
        publishedEvents.push(evt);
      },
      subscribe: () => () => {
        /* noop */
      },
    };

    const eventStore = new SessionEventStore(db, eventBus);
    const gateway = new McpGateway(db);

    let promptCalledWith: string | null = null;
    const fakeRuntimeHandle = {
      id: 'acp-mcp-123',
      history: 'fresh',
      closed: new Promise<void>(() => {
        /* noop */
      }),
      onError: () => {
        /* noop */
      },
      onClose: () => {
        /* noop */
      },
      prompt: async (text: string) => {
        await Promise.resolve();
        promptCalledWith = text;
        return { stopReason: 'end_turn' };
      },
      close: async () => {
        await Promise.resolve();
      },
      updateModel: async () => {
        await Promise.resolve();
      },
      updateConfigOption: () => [],
    } as unknown as AgentSession;

    const session = new ManagedSession(
      'sess-mcp',
      fakeRuntimeHandle,
      db,
      eventStore,
      '/tmp/proj-mcp',
      undefined,
      undefined,
      gateway,
    );

    try {
      await gateway.start();

      // Test Case 1: Plain text argument mapping to string schema parameter
      await session.prompt('/mock-calc:calculate 5 + 5');

      expect(promptCalledWith).toContain(
        'System Notification: The user manually executed the tool "mock-calc__calculate" with args: "{"expression":"5 + 5"}". Result:',
      );
      expect(promptCalledWith).toContain('result for 5 + 5: 42');

      const dbEvents = await db
        .select()
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, 'sess-mcp'));
      const providerTextEvent = dbEvents.find((e) => {
        const data = JSON.parse(e.data) as { role?: string; content?: string };
        return (
          data.role === 'provider' &&
          !!data.content &&
          data.content.includes('Manual Tool Execution Result [mock-calc__calculate]')
        );
      });
      expect(providerTextEvent).toBeDefined();

      // Test Case 2: JSON argument format
      await session.prompt('/mock-calc:calculate {"expression":"10 * 10"}');
      expect(promptCalledWith).toContain(
        'System Notification: The user manually executed the tool "mock-calc__calculate" with args: "{"expression":"10 * 10"}". Result:',
      );
      expect(promptCalledWith).toContain('result for 10 * 10: 42');

      // Test Case 3: Failed tool call
      let promptCalledOnFail = false;
      const fakeRuntimeHandleForFail: AgentSession = {
        ...fakeRuntimeHandle,
        prompt: async () => {
          await Promise.resolve();
          promptCalledOnFail = true;
          return { stopReason: 'end_turn' };
        },
      };

      const sessionWithFail = new ManagedSession(
        'sess-mcp-fail',
        fakeRuntimeHandleForFail,
        db,
        eventStore,
        '/tmp/proj-mcp',
        undefined,
        undefined,
        gateway,
      );

      await sessionWithFail.prompt('/mock-calc:fail');
      // On direct tool failure, prompt should not be called (returns early)
      expect(promptCalledOnFail).toBe(false);

      const dbEventsAfterFail = await db
        .select()
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, 'sess-mcp-fail'));
      const errorTextEvent = dbEventsAfterFail.find((e) => {
        const data = JSON.parse(e.data) as { role?: string; content?: string };
        return (
          data.role === 'provider' &&
          !!data.content &&
          data.content.includes('Manual Tool Execution Error:')
        );
      });
      expect(errorTextEvent).toBeDefined();

      const turnEndEvent = dbEventsAfterFail.find((e) => {
        if (e.type !== 'status') return false;
        const data = JSON.parse(e.data) as { status?: string };
        return data.status === 'turn_end';
      });
      expect(turnEndEvent).toBeDefined();

      // Test Case 4: Non-matching slash commands (like /goal) bypass interceptor
      let bypassedPrompt = false;
      const fakeRuntimeHandleForBypass: AgentSession = {
        ...fakeRuntimeHandle,
        prompt: async (text: string) => {
          await Promise.resolve();
          bypassedPrompt = true;
          expect(text).toBe('/goal do something');
          return { stopReason: 'end_turn' };
        },
      };

      const sessionWithBypass = new ManagedSession(
        'sess-mcp-bypass',
        fakeRuntimeHandleForBypass,
        db,
        eventStore,
        '/tmp/proj-mcp',
        undefined,
        undefined,
        gateway,
      );

      await sessionWithBypass.prompt('/goal do something');
      expect(bypassedPrompt).toBe(true);
    } finally {
      await gateway.stop();
      if (fs.existsSync(scriptPath)) {
        fs.unlinkSync(scriptPath);
      }
    }
  });
});
