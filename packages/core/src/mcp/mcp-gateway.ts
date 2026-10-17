import type { DbClient } from '../db/index.js';
import { mcpServers } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { noopLogger, type Logger } from '../logger.js';
import { createMcpConnection, type McpConnectionFactory } from './mcp-connection.js';
import { McpConnections } from './mcp-connections.js';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
}

/** Application facade: configured server selection and tool routing. */
export class McpGateway {
  private readonly connections: McpConnections;
  private revision = 0;
  private starting?: Promise<void>;
  private stopping?: Promise<void>;

  constructor(
    private readonly db: DbClient,
    private readonly logger: Logger = noopLogger,
    create: McpConnectionFactory = createMcpConnection,
  ) {
    this.connections = new McpConnections(create, logger);
  }

  getConnectionError(serverId: string): string | undefined {
    return this.connections.error(serverId);
  }
  isServerConnected(serverId: string): boolean {
    return !!this.connections.get(serverId);
  }

  start(): Promise<void> {
    if (this.starting) return this.starting;
    return this.startRevision(++this.revision);
  }

  private startRevision(revision: number): Promise<void> {
    const start = (async () => {
      await this.stopping;
      if (revision !== this.revision) return;
      this.connections.resume();
      const servers = this.db.select().from(mcpServers).where(eq(mcpServers.enabled, true)).all();
      for (const server of servers) {
        if (revision !== this.revision) break;
        if (this.connections.get(server.id)) continue;
        try {
          await this.connections.open(server, true);
        } catch (error) {
          if (revision === this.revision)
            this.logger.error(error, `Failed to connect to MCP server ${server.id}`);
        }
      }
    })().finally(() => {
      if (this.starting === start) this.starting = undefined;
    });
    this.starting = start;
    return start;
  }

  async getTools(): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    for (const [serverId, connection] of this.connections.entries()) {
      try {
        const response = await this.connections.run(connection, (client) => client.listTools());
        if (this.connections.get(serverId) !== connection) continue;
        for (const tool of response.tools)
          tools.push({
            name: `${serverId}__${tool.name}`,
            description: tool.description,
            inputSchema: tool.inputSchema,
            serverId,
          });
      } catch (error) {
        this.logger.error(error, `Failed to list tools for MCP server ${serverId}`);
      }
    }
    return tools;
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    this.connections.assertRunning();
    const connection = this.connections.get(serverId);
    if (connection)
      return this.connections.run(connection, (client) =>
        client.callTool({ name: toolName, arguments: args }),
      );
    const server = this.db.query.mcpServers
      .findFirst({ where: eq(mcpServers.id, serverId) })
      .sync();
    if (!server?.enabled || server.type !== 'remote' || !server.url)
      throw new Error(`MCP Server ${serverId} is not connected or active`);
    return this.connections.temporary(server, (client) =>
      client.callTool({ name: toolName, arguments: args }),
    );
  }

  async reload(): Promise<void> {
    const revision = ++this.revision;
    this.starting = undefined;
    this.stopping = this.connections.stop();
    await this.stopping;
    if (revision === this.revision) await this.startRevision(revision);
  }

  stop(): Promise<void> {
    ++this.revision;
    this.starting = undefined;
    return (this.stopping = this.connections.stop());
  }
}
