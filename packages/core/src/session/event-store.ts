import { eq, and, desc, gte, sql } from 'drizzle-orm';
import { sessionEvents, sessions } from '../db/schema.js';
import type { DbClient } from '../db/index.js';
import type { IEventBus } from './manager.js';
import type { SessionEvent } from '@agentctl/shared';
import type { SessionEventDbRow } from '../db/zod-schemas.js';

interface TokenMetadata {
  promptTokens?: number;
  completionTokens?: number;
}

function extractTokens(metadata: unknown): number {
  if (!metadata) return 0;
  let parsed: TokenMetadata;
  if (typeof metadata === 'string') {
    try {
      parsed = JSON.parse(metadata) as TokenMetadata;
    } catch {
      return 0;
    }
  } else if (typeof metadata === 'object') {
    parsed = metadata;
  } else {
    return 0;
  }
  return (parsed.promptTokens ?? 0) + (parsed.completionTokens ?? 0);
}

export class SessionEventStore {
  constructor(
    private db: DbClient,
    public eventBus: IEventBus,
  ) {}

  async recalculateTotalTokens(sessionId: string): Promise<void> {
    const events = await this.db
      .select({ metadata: sessionEvents.metadata })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId));

    let total = 0;
    for (const e of events) {
      total += extractTokens(e.metadata);
    }

    await this.db
      .update(sessions)
      .set({ totalTokens: Math.max(0, total) })
      .where(eq(sessions.id, sessionId));
  }

  private async incrementTotalTokens(sessionId: string, delta: number): Promise<void> {
    if (delta === 0) return;
    await this.db
      .update(sessions)
      .set({ totalTokens: sql`MAX(0, ${sessions.totalTokens} + ${delta})` })
      .where(eq(sessions.id, sessionId));
  }

  private async decrementTotalTokens(sessionId: string, delta: number): Promise<void> {
    if (delta === 0) return;
    await this.db
      .update(sessions)
      .set({ totalTokens: sql`MAX(0, ${sessions.totalTokens} - ${delta})` })
      .where(eq(sessions.id, sessionId));
  }

  /**
   * Publish-only: sends the row to the bus without persisting it (transient
   * live update). When `delta` is provided the payload carries wire-only delta
   * semantics: consumers append it to the existing event instead of replacing.
   */
  publishTransient(event: SessionEventDbRow, delta?: string): void {
    this.eventBus.publish(delta !== undefined ? { ...event, delta } : event);
  }

  async append(
    sessionId: string,
    type: SessionEvent['type'],
    data: unknown,
    parentEventId?: number | null,
    metadata?: unknown,
  ): Promise<number> {
    const inserted = await this.db
      .insert(sessionEvents)
      .values({
        sessionId,
        type,
        data: JSON.stringify(data),
        parentEventId: parentEventId ?? null,
        metadata: metadata ? JSON.stringify(metadata) : null,
      })
      .returning();

    const first = inserted[0];
    this.eventBus.publish({
      ...first,
      createdAt: new Date(first.createdAt),
    });

    void this.incrementTotalTokens(sessionId, extractTokens(metadata)).catch(() => {
      // ignore token refresh failure
    });

    return first.id;
  }

  async update(eventId: number, data: unknown, metadata?: unknown): Promise<void> {
    await this.performUpdate(eventId, data, metadata, true);
  }

  async updateSilently(eventId: number, data: unknown, metadata?: unknown): Promise<void> {
    await this.performUpdate(eventId, data, metadata, false);
  }

  private async performUpdate(
    eventId: number,
    data: unknown,
    metadata?: unknown,
    shouldPublish = true,
  ): Promise<void> {
    const existing = await this.getEventWithMetadataFull(eventId);
    const oldTokens = existing ? extractTokens(existing.metadata) : 0;
    const newTokens = metadata === undefined ? oldTokens : extractTokens(metadata);
    const delta = newTokens - oldTokens;

    let mergedData = data;
    if (
      existing &&
      typeof existing.data === 'object' &&
      existing.data !== null &&
      typeof data === 'object' &&
      data !== null
    ) {
      const cleanData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (value !== undefined) {
          cleanData[key] = value;
        }
      }
      mergedData = { ...(existing.data as Record<string, unknown>), ...cleanData };
    }
    const updateValues: { data: string; metadata?: string | null } = {
      data: JSON.stringify(mergedData),
    };
    if (metadata !== undefined) {
      updateValues.metadata = metadata ? JSON.stringify(metadata) : null;
    }
    const updated = await this.db
      .update(sessionEvents)
      .set(updateValues)
      .where(eq(sessionEvents.id, eventId))
      .returning();

    const first = updated.length > 0 ? updated[0] : undefined;
    if (shouldPublish && first) {
      this.eventBus.publish({
        ...first,
        createdAt: new Date(first.createdAt),
      });
    }

    if (first) {
      void this.incrementTotalTokens(first.sessionId, delta).catch(() => {
        // ignore token refresh failure
      });
    }
  }

  private async getEventWithMetadataFull(
    eventId: number,
  ): Promise<{ id: number; type: string; data: unknown; metadata: unknown } | null> {
    const rows = await this.db
      .select({
        id: sessionEvents.id,
        type: sessionEvents.type,
        data: sessionEvents.data,
        metadata: sessionEvents.metadata,
        sessionId: sessionEvents.sessionId,
      })
      .from(sessionEvents)
      .where(eq(sessionEvents.id, eventId))
      .limit(1);

    if (rows.length === 0) return null;
    const first = rows[0];

    const parsedData: unknown =
      typeof first.data === 'string' ? JSON.parse(first.data) : first.data;

    return {
      id: first.id,
      type: first.type,
      data: parsedData,
      metadata: first.metadata,
    };
  }

  async getEvent(eventId: number): Promise<{ id: number; type: string; data: unknown } | null> {
    const rows = await this.db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.id, eventId))
      .limit(1);

    if (rows.length === 0) return null;
    const first = rows[0];

    const parsedData = (
      typeof first.data === 'string' ? JSON.parse(first.data) : first.data
    ) as unknown;

    return {
      id: first.id,
      type: first.type,
      data: parsedData,
    };
  }

  async findLastEventByType(
    sessionId: string,
    type: SessionEvent['type'],
  ): Promise<{ id: number; data: unknown } | null> {
    const last = await this.db
      .select()
      .from(sessionEvents)
      .where(and(eq(sessionEvents.sessionId, sessionId), eq(sessionEvents.type, type)))
      .orderBy(desc(sessionEvents.id))
      .limit(1);

    if (last.length === 0) return null;
    const first = last[0];

    const parsedData = (
      typeof first.data === 'string' ? JSON.parse(first.data) : first.data
    ) as unknown;

    return {
      id: first.id,
      data: parsedData,
    };
  }

  async deleteEventsAfter(sessionId: string, eventId: number): Promise<void> {
    await this.backupAndDeleteEventsAfter(sessionId, eventId);
  }

  async backupAndDeleteEventsAfter(
    sessionId: string,
    eventId: number,
  ): Promise<SessionEventDbRow[]> {
    const toDelete = await this.db
      .select()
      .from(sessionEvents)
      .where(and(gte(sessionEvents.id, eventId), eq(sessionEvents.sessionId, sessionId)))
      .orderBy(sessionEvents.id);

    let deletedTokens = 0;
    for (const e of toDelete) {
      deletedTokens += extractTokens(e.metadata);
    }

    await this.db
      .delete(sessionEvents)
      .where(and(gte(sessionEvents.id, eventId), eq(sessionEvents.sessionId, sessionId)));

    void this.decrementTotalTokens(sessionId, deletedTokens).catch(() => undefined);

    return toDelete;
  }

  async restoreEvents(sessionId: string, rows: SessionEventDbRow[]): Promise<void> {
    if (rows.length === 0) return;

    await this.db.insert(sessionEvents).values(
      rows.map((row) => ({
        id: row.id,
        sessionId: row.sessionId,
        type: row.type as (typeof sessionEvents.$inferInsert)['type'],
        data: row.data,
        parentEventId: row.parentEventId,
        metadata: row.metadata,
        createdAt: new Date(row.createdAt),
      })),
    );

    let restoredTokens = 0;
    for (const row of rows) {
      restoredTokens += extractTokens(row.metadata);
    }

    void this.incrementTotalTokens(sessionId, restoredTokens).catch(() => undefined);
  }

  async getEventWithMetadata(
    sessionId: string,
    eventId: number,
  ): Promise<{ id: number; type: string; data: unknown; metadata: unknown } | null> {
    const rows = await this.db
      .select()
      .from(sessionEvents)
      .where(and(eq(sessionEvents.id, eventId), eq(sessionEvents.sessionId, sessionId)))
      .limit(1);

    if (rows.length === 0) return null;
    const first = rows[0];

    const parsedData: unknown =
      typeof first.data === 'string' ? JSON.parse(first.data) : first.data;
    const parsedMetadata: unknown = first.metadata
      ? typeof first.metadata === 'string'
        ? JSON.parse(first.metadata)
        : first.metadata
      : {};

    return {
      id: first.id,
      type: first.type,
      data: parsedData,
      metadata: parsedMetadata,
    };
  }
}
