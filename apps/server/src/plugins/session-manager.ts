import fp from 'fastify-plugin';
import type { SessionManager } from '@agentctl/core/session';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    sessionManager: SessionManager;
  }
}

export default fp((fastify: FastifyInstance) => {
  fastify.addHook('onClose', () => {
    void fastify.sessionManager.stopAll();
  });

  return Promise.resolve();
});
