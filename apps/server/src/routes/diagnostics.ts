import type { FastifyPluginCallback } from 'fastify';

export const diagnosticsRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get('/diagnostics/transport', (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header(
      'Content-Disposition',
      'attachment; filename="agentctl-transport-diagnostics.json"',
    );
    return fastify.providerRegistry.getTransportDiagnostics();
  });
  done();
};
