import Fastify from 'fastify';
import { initServer } from '@ts-rest/fastify';
import { providersContract } from '@agentctl/shared';
import { expect, test, vi } from 'vitest';
import { createProvidersRouter } from './providers.router.js';
import { AppError } from '../../errors/app-error.js';

test('browser auth responses reject expired or wrong-profile requests', async () => {
  const app = Fastify();
  let answered = false;
  const respondAuthInteraction = vi.fn((providerId: string, interactionId: string) => {
    if (providerId !== 'work' || interactionId !== 'current' || answered) return false;
    answered = true;
    return true;
  });
  app.decorate('providerRegistry', {
    getAuthCoordinator: () => ({ respondAuthInteraction }),
  } as never);
  app.setErrorHandler((error, _request, reply) =>
    reply
      .code(error instanceof AppError ? error.statusCode : 500)
      .send({ message: error instanceof Error ? error.message : String(error) }),
  );
  const server = initServer();
  await app.register(server.plugin(server.router(providersContract, createProvidersRouter(app))));
  const respond = (id: string, interactionId: string) =>
    app.inject({
      method: 'POST',
      url: `/api/providers/${id}/auth/respond`,
      payload: { interactionId, accepted: true },
    });
  try {
    expect((await respond('personal', 'current')).statusCode).toBe(409);
    expect((await respond('work', 'expired')).statusCode).toBe(409);
    expect((await respond('work', 'current')).statusCode).toBe(200);
    expect((await respond('work', 'current')).statusCode).toBe(409);
  } finally {
    await app.close();
  }
});
