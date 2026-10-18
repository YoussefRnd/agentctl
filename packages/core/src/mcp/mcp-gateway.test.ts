import { test, describe, expect } from 'vite-plus/test';
import { McpGateway } from './mcp-gateway.js';
import { createDatabase } from '../db/index.js';
import { mcpServers } from '../db/schema.js';
import { noopLogger } from '../logger.js';
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
                expression: { type: 'string' }
              },
              required: ['expression']
            }
          }
        ]
      };
    } else if (req.method === 'tools/call') {
      if (req.params.name === 'calculate') {
        res.result = {
          content: [
            {
              type: 'text',
              text: 'result: 42'
            }
          ]
        };
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

describe('McpGateway', () => {
  test('starts, discovers tools, executes calls, and stops', async () => {
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `mock-mcp-server-${String(Date.now())}.js`);
    fs.writeFileSync(scriptPath, mcpServerScript, 'utf8');

    const db = createDatabase(':memory:');

    // Insert an enabled mock stdio MCP server row
    await db.insert(mcpServers).values({
      id: 'mock-calc-server',
      name: 'Calculator Server',
      command: 'node',
      launchArgs: JSON.stringify([scriptPath]),
      launchEnv: '{}',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const gateway = new McpGateway(db, noopLogger);

    try {
      // 1. Start the gateway
      await gateway.start();

      // 2. Discover tools
      const tools = await gateway.getTools();
      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe('mock-calc-server__calculate');
      expect(tools[0].serverId).toBe('mock-calc-server');
      expect(tools[0].description).toBe('Performs basic math');

      // 3. Call tool
      const result = await gateway.callTool('mock-calc-server', 'calculate', {
        expression: '2 + 2',
      });
      const typedResult = result as { content: { text: string }[] };
      expect(typedResult).toBeDefined();
      expect(typedResult.content).toBeDefined();
      expect(typedResult.content[0].text).toBe('result: 42');
    } finally {
      // 4. Stop the gateway and cleanup temp file
      await gateway.stop();
      if (fs.existsSync(scriptPath)) {
        fs.unlinkSync(scriptPath);
      }
    }
  });

  test('captures connection errors when start fails', async () => {
    const db = createDatabase(':memory:');

    // Insert an enabled mock stdio MCP server row with invalid command config
    await db.insert(mcpServers).values({
      id: 'invalid-server',
      name: 'Invalid Server',
      command: 'nonexistent-command-12345',
      launchArgs: JSON.stringify([]),
      launchEnv: '{}',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const gateway = new McpGateway(db, noopLogger);

    try {
      await gateway.start();
      const err = gateway.getConnectionError('invalid-server');
      expect(err).toBeDefined();
      expect(err).toContain('ENOENT');
    } finally {
      await gateway.stop();
    }
  });

  test('executes remote stateless Streamable HTTP tool calls on demand', async () => {
    const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
    const { StreamableHTTPServerTransport } =
      await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const { ListToolsRequestSchema, CallToolRequestSchema } =
      await import('@modelcontextprotocol/sdk/types.js');
    const http = await import('node:http');

    const mcpServer = new Server(
      { name: 'remote-test-server', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );

    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'remote-echo',
          description: 'Echoes message from remote serverless MCP',
          inputSchema: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
          },
        },
      ],
    }));

    mcpServer.setRequestHandler(CallToolRequestSchema, async (req) => {
      const args = req.params.arguments as { message?: string };
      return {
        content: [{ type: 'text', text: `remote echo: ${args.message ?? ''}` }],
      };
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => 'test-session-123',
    });
    await mcpServer.connect(transport);

    const httpServer = http.createServer((req, res) => {
      void transport.handleRequest(req, res);
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });

    const addr = httpServer.address() as { port: number };
    const endpointUrl = `http://127.0.0.1:${String(addr.port)}/mcp`;

    const db = createDatabase(':memory:');
    await db.insert(mcpServers).values({
      id: 'stateless-remote-server',
      name: 'Stateless Remote Server',
      type: 'remote',
      url: endpointUrl,
      headers: JSON.stringify({ Authorization: 'Bearer test-token' }),
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const gateway = new McpGateway(db, noopLogger);

    try {
      const result = await gateway.callTool('stateless-remote-server', 'remote-echo', {
        message: 'hello stateless world',
      });
      const typed = result as { content: { text: string }[] };
      expect(typed).toBeDefined();
      expect(typed.content[0].text).toBe('remote echo: hello stateless world');
    } finally {
      await gateway.stop();
      await new Promise<void>((resolve) => {
        httpServer.close(() => {
          resolve();
        });
      });
    }
  });
});
