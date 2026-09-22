import type { FastifyInstance } from 'fastify';
import type { RouterImplementation } from '@ts-rest/fastify';
import { eq } from 'drizzle-orm';
import { mcpServers } from '@agentctl/core/db';
import { mcpContract, type McpToolResult } from '@agentctl/shared';
import { AppError } from '../../errors/app-error.js';

export function createMcpRouter(
  fastify: FastifyInstance,
): RouterImplementation<typeof mcpContract> {
  return {
    getMcpServers: async () => {
      const servers = await fastify.db.select().from(mcpServers);
      return {
        status: 200 as const,
        body: servers.map((s) => {
          let status: 'connected' | 'disconnected' | 'disabled' = 'disabled';
          if (s.enabled) {
            status = fastify.mcpGateway.isServerConnected(s.id) ? 'connected' : 'disconnected';
          }
          return {
            id: s.id,
            name: s.name,
            command: s.command,
            launchArgs: s.launchArgs,
            launchEnv: s.launchEnv,
            enabled: s.enabled,
            autoApprove: s.autoApprove,
            approvalPolicy: s.approvalPolicy,
            toolPermissions: s.toolPermissions,
            type: s.type as 'local' | 'remote',
            url: s.url,
            headers: s.headers,
            status,
            error: fastify.mcpGateway.getConnectionError(s.id) ?? null,
          };
        }),
      };
    },
    createMcpServer: async ({ body, request }) => {
      const rawBody = (request as unknown as { body?: Record<string, unknown> }).body;
      const approvalPolicySent = rawBody?.approvalPolicy !== undefined;
      const autoApproveSent = rawBody?.autoApprove !== undefined;

      let approvalPolicy = body.approvalPolicy;
      let autoApprove = body.autoApprove;

      if (!approvalPolicySent && autoApproveSent) {
        approvalPolicy = autoApprove ? 'auto_approve_all' : 'always_prompt';
      } else if (approvalPolicySent) {
        autoApprove = approvalPolicy === 'auto_approve_all';
      }

      const [created] = await fastify.db
        .insert(mcpServers)
        .values({
          id: body.id,
          name: body.name,
          command: body.command ?? null,
          launchArgs: body.launchArgs ?? '[]',
          launchEnv: body.launchEnv ?? '{}',
          enabled: body.enabled,
          autoApprove,
          approvalPolicy,
          toolPermissions: body.toolPermissions ?? '{}',
          type: body.type,
          url: body.url ?? null,
          headers: body.headers ?? null,
        })
        .returning();
      try {
        await fastify.mcpGateway.reload();
      } catch (err: unknown) {
        fastify.log.error(err, 'Failed to reload MCP gateway on createMcpServer');
      }
      const isConnected = created.enabled && fastify.mcpGateway.isServerConnected(created.id);
      fastify.eventBus.publishState({ topics: ['mcp'] });
      return {
        status: 201 as const,
        body: {
          id: created.id,
          name: created.name,
          command: created.command,
          launchArgs: created.launchArgs,
          launchEnv: created.launchEnv,
          enabled: created.enabled,
          autoApprove: created.autoApprove,
          approvalPolicy: created.approvalPolicy,
          toolPermissions: created.toolPermissions,
          type: created.type as 'local' | 'remote',
          url: created.url,
          status: (created.enabled ? (isConnected ? 'connected' : 'disconnected') : 'disabled') as
            'connected' | 'disconnected' | 'disabled',
        },
      };
    },
    updateMcpServer: async ({ params, body, request }) => {
      const { id } = params;
      const rawBody = (request as unknown as { body?: Record<string, unknown> }).body;
      const approvalPolicySent = rawBody?.approvalPolicy !== undefined;
      const autoApproveSent = rawBody?.autoApprove !== undefined;

      let approvalPolicy = body.approvalPolicy;
      let autoApprove = body.autoApprove;

      if (!approvalPolicySent && autoApproveSent) {
        approvalPolicy = autoApprove ? 'auto_approve_all' : 'always_prompt';
      } else if (approvalPolicySent) {
        autoApprove = approvalPolicy === 'auto_approve_all';
      }

      const results = await fastify.db
        .update(mcpServers)
        .set({
          name: body.name,
          command: body.command === undefined ? undefined : (body.command ?? null),
          launchArgs: body.launchArgs === null ? undefined : body.launchArgs,
          launchEnv: body.launchEnv === null ? undefined : body.launchEnv,
          enabled: body.enabled,
          autoApprove,
          approvalPolicy,
          toolPermissions: body.toolPermissions === null ? '{}' : body.toolPermissions,
          type: body.type,
          url: body.url === undefined ? undefined : (body.url ?? null),
          headers: body.headers === undefined ? undefined : (body.headers ?? null),
          updatedAt: new Date(),
        })
        .where(eq(mcpServers.id, id))
        .returning();
      if (results.length === 0) {
        throw new AppError('MCP server config not found', 404);
      }
      try {
        await fastify.mcpGateway.reload();
      } catch (err: unknown) {
        fastify.log.error(err, 'Failed to reload MCP gateway on updateMcpServer');
      }
      const updated = results[0];
      const isConnected = updated.enabled && fastify.mcpGateway.isServerConnected(updated.id);
      fastify.eventBus.publishState({ topics: ['mcp'] });
      return {
        status: 200 as const,
        body: {
          id: updated.id,
          name: updated.name,
          command: updated.command,
          launchArgs: updated.launchArgs,
          launchEnv: updated.launchEnv,
          enabled: updated.enabled,
          autoApprove: updated.autoApprove,
          approvalPolicy: updated.approvalPolicy,
          toolPermissions: updated.toolPermissions,
          type: updated.type as 'local' | 'remote',
          url: updated.url,
          headers: updated.headers,
          status: (updated.enabled ? (isConnected ? 'connected' : 'disconnected') : 'disabled') as
            'connected' | 'disconnected' | 'disabled',
        },
      };
    },
    deleteMcpServer: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      const result = await fastify.db.delete(mcpServers).where(eq(mcpServers.id, id)).returning();
      void fastify.mcpGateway.reload().catch((err: unknown) => {
        fastify.log.error(err, 'Failed to reload MCP gateway on deleteMcpServer');
      });
      if (result.length === 0) {
        throw new AppError('MCP server not found', 404);
      }
      fastify.eventBus.publishState({ topics: ['mcp'] });
      return {
        status: 204 as const,
        body: undefined,
      };
    },
    getMcpTools: async () => {
      const tools = await fastify.mcpGateway.getTools();
      return {
        status: 200 as const,
        body: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          serverId: t.serverId,
        })),
      };
    },
    callMcpTool: async ({ body }) => {
      const { serverId, toolName, arguments: args } = body;
      const result = await fastify.mcpGateway.callTool(serverId, toolName, args);
      return {
        status: 200 as const,
        body: result as McpToolResult,
      };
    },
  };
}
