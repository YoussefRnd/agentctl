import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { applicationInfo } from '../config/application-info.js';
import { jsonCodecs } from '../db/json-codecs.js';
import type { mcpServers } from '../db/schema.js';

export type McpServerConfig = typeof mcpServers.$inferSelect;
export interface McpConnection {
  connect(): Promise<void>;
  close(): Promise<void>;
  listTools: Client['listTools'];
  callTool: Client['callTool'];
  onclose?: () => void;
  onerror?: (error: Error) => void;
}
export type McpConnectionFactory = (server: McpServerConfig) => McpConnection;

/** Explicit SDK/transport adapter. A connection owns exactly one client and transport. */
export const createMcpConnection: McpConnectionFactory = (server) => {
  if (server.type === 'local' && !server.command)
    throw new Error('Local MCP server missing command config');
  if (server.type !== 'local' && !server.url)
    throw new Error('Remote MCP server missing URL config');
  const client = new Client(applicationInfo('agentctl-client-gateway'), { capabilities: {} });
  const transport =
    server.type === 'local'
      ? new StdioClientTransport({
          command: server.command!,
          args: jsonCodecs.stringArray(server.launchArgs),
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                (entry): entry is [string, string] => entry[1] !== undefined,
              ),
            ),
            ...jsonCodecs.stringRecord(server.launchEnv),
          },
        })
      : new StreamableHTTPClientTransport(new URL(server.url!), {
          requestInit: { headers: jsonCodecs.stringRecord(server.headers) },
        });
  const connection: McpConnection = {
    connect: () => client.connect(transport),
    close: async () => {
      try {
        await client.close();
      } finally {
        await transport.close();
      }
    },
    listTools: client.listTools.bind(client),
    callTool: client.callTool.bind(client),
  };
  // Preserve the SDK's transport handlers; application hooks belong on the client.
  client.onclose = () => connection.onclose?.();
  client.onerror = (error) => connection.onerror?.(error);
  return connection;
};
