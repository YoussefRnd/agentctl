import { z } from 'zod';
import { mcpToolResultSchema } from '../schemas/session.js';

export const mcpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string().nullable().optional(),
  launchArgs: z.string().nullable().optional(),
  launchEnv: z.string().nullable().optional(),
  enabled: z.boolean(),
  autoApprove: z.boolean(),
  approvalPolicy: z
    .enum(['always_prompt', 'auto_approve_all', 'deny_all'])
    .default('always_prompt'),
  toolPermissions: z.string().nullable().optional().default('{}'),
  type: z.enum(['local', 'remote']).default('local'),
  url: z.string().nullable().optional(),
  headers: z.string().nullable().optional(),
  status: z.enum(['connected', 'disconnected', 'disabled']).optional(),
  error: z.string().nullable().optional(),
});

export const mcpContract = {
  getMcpServers: {
    method: 'GET',
    path: '/api/mcp-servers',
    responses: {
      200: z.array(mcpServerSchema),
    },
    summary: 'Get all MCP servers',
  },
  createMcpServer: {
    method: 'POST',
    path: '/api/mcp-servers',
    body: mcpServerSchema,
    responses: {
      200: mcpServerSchema,
    },
    summary: 'Register an MCP server',
  },
  updateMcpServer: {
    method: 'PATCH',
    path: '/api/mcp-servers/:id',
    pathParams: z.object({ id: z.string() }),
    body: mcpServerSchema.partial(),
    responses: {
      200: mcpServerSchema,
    },
    summary: 'Update MCP server config',
  },
  deleteMcpServer: {
    method: 'DELETE',
    path: '/api/mcp-servers/:id',
    pathParams: z.object({ id: z.string() }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Delete MCP server',
  },
  getMcpTools: {
    method: 'GET',
    path: '/api/mcp/tools',
    responses: {
      200: z.array(
        z.object({
          name: z.string(),
          description: z.string().optional(),
          inputSchema: z.record(z.string(), z.unknown()),
          serverId: z.string(),
        }),
      ),
    },
    summary: 'Get all tools exposed by active MCP servers',
  },
  callMcpTool: {
    method: 'POST',
    path: '/api/mcp/tool/call',
    body: z.object({
      serverId: z.string(),
      toolName: z.string(),
      arguments: z.record(z.string(), z.unknown()),
    }),
    responses: {
      200: mcpToolResultSchema,
    },
    summary: 'Invoke a tool on a specific MCP server',
  },
} as const;
