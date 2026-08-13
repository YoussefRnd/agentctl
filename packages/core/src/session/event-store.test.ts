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

  describe('publishTransient', () => {
    test('forwards the event to the bus without touching the db', () => {
      const dbMethods = { select: vi.fn() };
      const mockDb = dbMethods as unknown as DbClient;

      const eventBus = { publish: vi.fn() } as unknown as IEventBus;
      const store = new SessionEventStore(mockDb, eventBus);

      const row = {
        id: 42,
        sessionId: 'session-1',
        parentEventId: 1,
        type: 'text' as const,
        data: JSON.stringify({ content: 'partial', role: 'provider' }),
        metadata: JSON.stringify({ durationMs: 300, completionTokens: 2 }),
        createdAt: new Date('2026-08-07T00:00:00.000Z'),
      };

      store.publishTransient(row);

      expect(eventBus.publish).toHaveBeenCalledTimes(1);
      expect(eventBus.publish).toHaveBeenCalledWith(row);
      expect(dbMethods.select).not.toHaveBeenCalled();
    });

    test('attaches the wire-only delta field when provided', () => {
      const dbMethods = { select: vi.fn() };
      const mockDb = dbMethods as unknown as DbClient;

      const eventBus = { publish: vi.fn() } as unknown as IEventBus;
      const store = new SessionEventStore(mockDb, eventBus);

      const row = {
        id: 42,
        sessionId: 'session-1',
        parentEventId: 1,
        type: 'text' as const,
        data: JSON.stringify({ content: '', role: 'provider' }),
        metadata: JSON.stringify({ durationMs: 300, completionTokens: 2 }),
        createdAt: new Date('2026-08-07T00:00:00.000Z'),
      };

      store.publishTransient(row, ' world');

      expect(eventBus.publish).toHaveBeenCalledTimes(1);
      expect(eventBus.publish).toHaveBeenCalledWith({ ...row, delta: ' world' });
      expect(dbMethods.select).not.toHaveBeenCalled();
    });
  });

  describe('updateSilently', () => {
    test('updates db and merges data but does not publish', async () => {
      const updatedRows = [
        {
          id: 7,
          sessionId: 'session-1',
          parentEventId: 1,
          type: 'text',
          data: JSON.stringify({ content: 'full text', role: 'provider' }),
          metadata: JSON.stringify({ durationMs: 500, completionTokens: 3 }),
          createdAt: new Date(),
        },
      ];

      let setValues: { data: string } | undefined;
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([
                  {
                    id: 7,
                    sessionId: 'session-1',
                    type: 'text',
                    data: JSON.stringify({ content: 'part', role: 'provider' }),
                    metadata: JSON.stringify({ durationMs: 100, completionTokens: 1 }),
                  },
                ]),
            }),
          }),
        }),
        update: () => ({
          set: (v: { data: string }) => {
            if ('data' in v) {
              setValues = v;
            }
            return {
              where: () => ({
                returning: () => Promise.resolve(updatedRows),
              }),
            };
          },
        }),
      } as unknown as DbClient;

      const eventBus = { publish: vi.fn() } as unknown as IEventBus;
      const store = new SessionEventStore(mockDb, eventBus);

      await store.updateSilently(7, { content: 'full text', role: 'provider' });

      expect(eventBus.publish).not.toHaveBeenCalled();
      expect(setValues?.data).toBe(JSON.stringify({ content: 'full text', role: 'provider' }));
    });

    test('does not publish even when metadata delta is non-zero', async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([
                  {
                    id: 7,
                    sessionId: 'session-1',
                    type: 'text',
                    data: JSON.stringify({ content: 'abc' }),
                    metadata: JSON.stringify({ durationMs: 100, completionTokens: 1 }),
                  },
                ]),
            }),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => ({
              returning: () => Promise.resolve([{ id: 7, sessionId: 'session-1' }]),
            }),
          }),
        }),
      } as unknown as DbClient;

      const eventBus = { publish: vi.fn() } as unknown as IEventBus;
      const store = new SessionEventStore(mockDb, eventBus);

      await store.updateSilently(7, { content: 'abcd' }, { durationMs: 200, completionTokens: 3 });

      expect(eventBus.publish).not.toHaveBeenCalled();
    });
  });
});
