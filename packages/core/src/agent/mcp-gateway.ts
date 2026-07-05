import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { DbClient } from './acp-session.js';
import { mcpServers } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { Logger } from '../logger.js';
import { noopLogger } from '../logger.js';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
}

export class McpGateway {
  private activeClients = new Map<string, { client: Client; transport: Transport }>();
  private connectionErrors = new Map<string, string>();

  constructor(
    private db: DbClient,
    private logger: Logger = noopLogger,
  ) {}

  getConnectionError(serverId: string): string | undefined {
    return this.connectionErrors.get(serverId);
  }

  async start(): Promise<void> {
    const enabledServers = await this.db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.enabled, true));

    this.logger.info(`Starting MCP Gateway with ${String(enabledServers.length)} enabled servers`);

    for (const server of enabledServers) {
      this.connectionErrors.delete(server.id);
      try {
        let transport: Transport;
        const client = new Client(
          {
            name: 'agentctl-client-gateway',
            version: '1.0.0',
          },
          {
            capabilities: {},
          },
        );

        if (server.type === 'local') {
          if (!server.command) {
            this.logger.warn({ serverId: server.id }, 'Local MCP server missing command config');
            continue;
          }
          const args = JSON.parse(server.launchArgs) as string[];
          const env = JSON.parse(server.launchEnv) as Record<string, string>;
          this.logger.info(
            { serverId: server.id, command: server.command, args },
            'Spawning stdio MCP server',
          );
          const cleanEnv: Record<string, string> = {};
          for (const [k, v] of Object.entries(process.env)) {
            if (v !== undefined) {
              cleanEnv[k] = v;
            }
          }
          Object.assign(cleanEnv, env);

          transport = new StdioClientTransport({
            command: server.command,
            args,
            env: cleanEnv,
          });
        } else {
          const sseUrl = server.url ?? '';
          if (!sseUrl) {
            this.logger.warn({ serverId: server.id }, 'Remote MCP server missing URL config');
            continue;
          }

          let headers: Record<string, string> = {};
          if (server.headers) {
            try {
              headers = JSON.parse(server.headers) as Record<string, string>;
            } catch {
              // ignore
            }
          }

          this.logger.info(
            { serverId: server.id, url: sseUrl },
            'Connecting to Remote Streamable HTTP MCP server',
          );
          transport = new StreamableHTTPClientTransport(new URL(sseUrl), {
            requestInit: {
              headers,
            },
          });
        }

        await client.connect(transport);

        transport.onclose = () => {
          this.activeClients.delete(server.id);
          this.logger.warn({ serverId: server.id }, `MCP server ${server.name} disconnected`);
        };
        transport.onerror = (err) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.connectionErrors.set(server.id, msg);
          this.logger.error(err, `MCP server ${server.id} error`);
        };

        this.activeClients.set(server.id, { client, transport });
        this.logger.info({ serverId: server.id }, 'Successfully connected to MCP server');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.connectionErrors.set(server.id, msg);
        this.logger.error(
          err,
          `Failed to start or connect to MCP server ${server.id} (${server.name})`,
        );
      }
    }
  }

  async getTools(): Promise<McpTool[]> {
    const allTools: McpTool[] = [];

    for (const [serverId, { client }] of this.activeClients.entries()) {
      try {
        const response = await client.listTools();
        for (const tool of response.tools) {
          allTools.push({
            name: `${serverId}__${tool.name}`,
            description: tool.description,
            inputSchema: tool.inputSchema,
            serverId,
          });
        }
      } catch (err: unknown) {
        this.logger.error(err, `Failed to list tools for MCP server ${serverId}`);
      }
    }

    return allTools;
  }

  isServerConnected(serverId: string): boolean {
    return this.activeClients.has(serverId);
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const entry = this.activeClients.get(serverId);
    if (!entry) {
      throw new Error(`MCP Server ${serverId} is not connected or active`);
    }

    this.logger.info({ serverId, toolName, args }, 'Invoking MCP tool');
    return await entry.client.callTool({
      name: toolName,
      arguments: args,
    });
  }

  async reload(): Promise<void> {
    this.logger.info('Reloading MCP Gateway connections');
    await this.stop();
    await this.start();
  }

  async stop(): Promise<void> {
    this.logger.info('Shutting down MCP Gateway');
    for (const [serverId, { transport }] of this.activeClients.entries()) {
      try {
        await transport.close();
      } catch (err: unknown) {
        this.logger.error(err, `Failed to cleanly close transport for MCP server ${serverId}`);
      }
    }
    this.activeClients.clear();
    this.connectionErrors.clear();
  }
}
