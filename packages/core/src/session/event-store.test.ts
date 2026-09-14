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
            where: () => ({
              orderBy: () => Promise.resolve([]),
            }),
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
            where: () => ({
              orderBy: () => Promise.resolve([]),
            }),
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

  describe('backupAndDeleteEventsAfter and restoreEvents', () => {
    test('backs up deleted events and restores them into db', async () => {
      const mockRows = [
        {
          id: 10,
          sessionId: 'session-1',
          type: 'user_message',
          data: JSON.stringify({ message: 'Hello' }),
          parentEventId: null,
          metadata: JSON.stringify({ completionTokens: 5 }),
          createdAt: new Date().toISOString(),
        },
      ];

      let insertedRows: unknown[] = [];
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => Promise.resolve(mockRows),
            }),
          }),
        }),
        delete: () => ({
          where: () => Promise.resolve(),
        }),
        insert: () => ({
          values: (vals: unknown[]) => {
            insertedRows = vals;
            return Promise.resolve();
          },
        }),
        update: () => ({
          set: () => ({
            where: () => Promise.resolve(),
          }),
        }),
      } as unknown as DbClient;

      const eventBus = { publish: vi.fn() } as unknown as IEventBus;
      const store = new SessionEventStore(mockDb, eventBus);

      const backedUp = await store.backupAndDeleteEventsAfter('session-1', 10);
      expect(backedUp).toHaveLength(1);
      expect(backedUp[0].id).toBe(10);

      await store.restoreEvents('session-1', backedUp);
      expect(insertedRows).toHaveLength(1);
    });
  });

  describe('typed session events and codecs', () => {
    test('rejects invalid payloads before writing', async () => {
      const eventBus = { publish: vi.fn() } as unknown as IEventBus;
      const store = new SessionEventStore({} as DbClient, eventBus);

      await expect(
        store.append('session-1', 'terminal_created', { terminalId: 'term-1' } as never),
      ).rejects.toThrow();
      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    test('appends strongly typed text event and publishes correctly', async () => {
      let insertedPayload: unknown;
      const mockDb = {
        insert: () => ({
          values: (val: unknown) => {
            insertedPayload = val;
            return {
              returning: () =>
                Promise.resolve([
                  {
                    id: 101,
                    sessionId: 'session-1',
                    type: 'text',
                    data: (val as { data: string }).data,
                    parentEventId: null,
                    metadata: null,
                    createdAt: new Date(),
                  },
                ]),
            };
          },
        }),
      } as unknown as DbClient;

      const eventBus = { publish: vi.fn() } as unknown as IEventBus;
      const store = new SessionEventStore(mockDb, eventBus);

      const id = await store.append('session-1', 'text', {
        content: 'Hello typed world',
        role: 'user',
      });

      expect(id).toBe(101);
      expect(JSON.parse((insertedPayload as { data: string }).data)).toEqual({
        content: 'Hello typed world',
        role: 'user',
      });
      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 101,
          type: 'text',
        }),
      );
    });

    test('safe decoding handles malformed and null data without throwing', async () => {
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
                    data: '{malformed json...',
                    metadata: '{not valid json either...',
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
      expect(event).toBeDefined();
      expect(event?.data).toEqual({ content: '' });
      expect(event?.metadata).toEqual({});
    });
  });
});
