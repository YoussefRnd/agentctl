import type { FastifyInstance } from 'fastify';
import type { RouterImplementation } from '@ts-rest/fastify';
import { settingsContract } from '@agentctl/shared';
import { AppError } from '../../errors/app-error.js';

export function createSettingsRouter(
  fastify: FastifyInstance,
): RouterImplementation<typeof settingsContract> {
  return {
    getSettings: async () => ({ status: 200, body: await fastify.services.settings.read() }),
    patchSettings: async ({ body }) => {
      try {
        return { status: 200, body: await fastify.services.settings.patch(body) };
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 400)
          return { status: 400, body: { message: error.message } };
        throw error;
      }
    },
  };
}
