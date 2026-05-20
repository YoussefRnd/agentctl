import fp from 'fastify-plugin';
import { SessionManager } from '@agentctl/core';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    sessionManager: SessionManager;
  }
}

export default fp((fastify: FastifyInstance) => {
  const manager = new SessionManager(
    fastify.db,
    fastify.eventBus,
    fastify.log,
  );

  fastify.decorate('sessionManager', manager);

  fastify.addHook('onClose', () => {
    manager.stopAll();
  });

  return Promise.resolve();
});
