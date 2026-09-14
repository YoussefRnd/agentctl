import type { FastifyInstance } from 'fastify';
import type { RouterImplementation } from '@ts-rest/fastify';
import { diagnosticsContract } from '@agentctl/shared';

export function createDiagnosticsRouter(
  fastify: FastifyInstance,
): RouterImplementation<typeof diagnosticsContract> {
  return {
    getTransportDiagnostics: async ({ reply }) => {
      reply.header('Cache-Control', 'no-store');
      reply.header(
        'Content-Disposition',
        'attachment; filename="agentctl-transport-diagnostics.json"',
      );
      const snapshot = fastify.providerRegistry.getTransportDiagnostics();
      return {
        status: 200 as const,
        body: snapshot,
      };
    },
  };
}
