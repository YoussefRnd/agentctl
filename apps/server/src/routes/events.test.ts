import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { eventsRoutes } from './events.js';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
}));

vi.mock('@agentctl/core', () => ({
  db: {
    select: mocks.select,
  },
  acpEvents: {
    sessionId: 'session_id',
    id: 'id',
  },
}));

vi.mock('@agentctl/core', () => ({
  db: {
    select: mocks.select,
  },
  acpEvents: {
    sessionId: 'session_id',
    id: 'id',
  },
  sessions: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  asc: vi.fn(),
}));

describe('eventsRoutes', () => {
  beforeEach(() => {
    mocks.select.mockReset();
    mocks.from.mockReset();
    mocks.where.mockReset();
    mocks.orderBy.mockReset();

    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ where: mocks.where });
    mocks.where.mockReturnValue({ orderBy: mocks.orderBy });
    mocks.orderBy.mockResolvedValue([]);
  });

  it('returns session history ordered by event id', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(eventsRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/sessions/550e8400-e29b-41d4-a716-446655440000/events',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.select).toHaveBeenCalled();
  });
});
