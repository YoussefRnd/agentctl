import type { FastifyInstance } from 'fastify';
import type { RouterImplementation } from '@ts-rest/fastify';
import { searchContract } from '@agentctl/shared';

export function createSearchRouter(
  fastify: FastifyInstance,
): RouterImplementation<typeof searchContract> {
  return {
    searchEvents: async ({ query }) => ({
      status: 200,
      body: await fastify.services.search.search(query),
    }),
  };
}
