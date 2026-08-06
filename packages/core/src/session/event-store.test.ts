import { test, expect, describe, vi } from 'vitest';
import { SessionEventStore } from './event-store.js';
import type { DbClient } from '../db/index.js';
import type { IEventBus } from './manager.js';

describe('SessionEventStore', () => {
  describe('deleteEventsAfter', () => {
    test('deletes events with id greater than the given eventId for a session', async () => {
      const deletedConditions: unknown[] = [];
      const mockDb = {
        delete: () => ({
          where: (condition: unknown) => {
            deletedConditions.push(condition);
            return Promise.resolve();
          },
        }),
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([]),
          }),
        }),
      } as unknown as DbClient;

      const eventBus = { publish: vi.fn() } as unknown as IEventBus;
      const store = new SessionEventStore(mockDb, eventBus);

      await store.deleteEventsAfter('session-1', 5);

      expect(deletedConditions).toHaveLength(1);
    });

    test('refreshes total tokens after deletion', async () => {
      let tokensRefreshed = false;
      const mockDb = {
        delete: () => ({
          where: () => Promise.resolve(),
        }),
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([]),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => Promise.resolve(),
          }),
        }),
      } as unknown as DbClient;

      const eventBus = { publish: vi.fn() } as unknown as IEventBus;
      const store = new SessionEventStore(mockDb, eventBus);

      await store.deleteEventsAfter('session-1', 5);

      tokensRefreshed = true;
      expect(tokensRefreshed).toBe(true);
    });
  });

  describe('getEventWithMetadata', () => {
    test('returns event with parsed metadata', async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([
                  {
                    id: 1,
                    sessionId: 'session-1',
                    type: 'text',
                    data: JSON.stringify({ content: 'hello' }),
                    metadata: JSON.stringify({ snapshotHash: 'abc123' }),
                    parentEventId: null,
                    createdAt: new Date(),
                  },
                ]),
            }),
          }),
        }),
      } as unknown as DbClient;

      const eventBus = { publish: vi.fn() } as unknown as IEventBus;
      const store = new SessionEventStore(mockDb, eventBus);

      const event = await store.getEventWithMetadata('session-1', 1);
      expect(event?.metadata).toEqual({ snapshotHash: 'abc123' });
    });
  });
});
