import type { FastifyInstance } from 'fastify';
import type { RouterImplementation } from '@ts-rest/fastify';
import { mcpContract } from '@agentctl/shared';

function approvalPresence(request: unknown) {
  const body = (request as { body?: Record<string, unknown> }).body;
  return {
    approvalPolicySent: body?.approvalPolicy !== undefined,
    autoApproveSent: body?.autoApprove !== undefined,
  };
}

export function createMcpRouter(
  fastify: FastifyInstance,
): RouterImplementation<typeof mcpContract> {
  return {
    getMcpServers: async () => ({ status: 200, body: await fastify.services.mcp.getMcpServers() }),
    createMcpServer: async ({ body, request }) => ({
      status: 201,
      body: await fastify.services.mcp.createMcpServer(body, approvalPresence(request)),
    }),
    updateMcpServer: async ({ params, body, request }) => ({
      status: 200,
      body: await fastify.services.mcp.updateMcpServer(params.id, body, approvalPresence(request)),
    }),
    deleteMcpServer: async ({ params }) => {
      await fastify.services.mcp.deleteMcpServer(params.id);
      return { status: 204, body: undefined };
    },
    getMcpTools: async () => ({ status: 200, body: await fastify.services.mcp.getMcpTools() }),
    callMcpTool: async ({ body }) => ({
      status: 200,
      body: await fastify.services.mcp.callMcpTool(body),
    }),
  };
}
