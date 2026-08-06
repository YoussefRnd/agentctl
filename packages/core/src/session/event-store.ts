import { eq, and, desc, gte, sql } from 'drizzle-orm';
import { acpEvents, sessions } from '../db/schema.js';
import type { DbClient } from '../db/index.js';
import type { IEventBus } from './manager.js';
import type { ACPEvent } from '@agentctl/shared';

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
      .select({ metadata: acpEvents.metadata })
      .from(acpEvents)
      .where(eq(acpEvents.sessionId, sessionId));

    let total = 0;
    for (const e of events) {
      total += extractTokens(e.metadata);
    }

    await this.db.update(sessions).set({ totalTokens: total }).where(eq(sessions.id, sessionId));
  }

  private async incrementTotalTokens(sessionId: string, delta: number): Promise<void> {
    if (delta === 0) return;
    await this.db
      .update(sessions)
      .set({ totalTokens: sql`${sessions.totalTokens} + ${delta}` })
      .where(eq(sessions.id, sessionId));
  }

  private async decrementTotalTokens(sessionId: string, delta: number): Promise<void> {
    if (delta === 0) return;
    await this.db
      .update(sessions)
      .set({ totalTokens: sql`${sessions.totalTokens} - ${delta}` })
      .where(eq(sessions.id, sessionId));
  }

  async append(
    sessionId: string,
    type: ACPEvent['type'],
    data: unknown,
    parentEventId?: number | null,
    metadata?: unknown,
  ): Promise<number> {
    const inserted = await this.db
      .insert(acpEvents)
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
    const existing = await this.getEventWithMetadataFull(eventId);
    const oldTokens = existing ? extractTokens(existing.metadata) : 0;
    const newTokens = extractTokens(metadata);
    const delta = newTokens - oldTokens;

    let mergedData = data;
    if (
      existing &&
      typeof existing.data === 'object' &&
      existing.data !== null &&
      typeof data === 'object' &&
      data !== null
    ) {
      mergedData = { ...existing.data, ...data };
    }
    const updateValues: { data: string; metadata?: string | null } = {
      data: JSON.stringify(mergedData),
    };
    if (metadata !== undefined) {
      updateValues.metadata = metadata ? JSON.stringify(metadata) : null;
    }
    const updated = await this.db
      .update(acpEvents)
      .set(updateValues)
      .where(eq(acpEvents.id, eventId))
      .returning();

    const first = updated[0];
    this.eventBus.publish({
      ...first,
      createdAt: new Date(first.createdAt),
    });

    void this.incrementTotalTokens(first.sessionId, delta).catch(() => {
      // ignore token refresh failure
    });
  }

  private async getEventWithMetadataFull(
    eventId: number,
  ): Promise<{ id: number; type: string; data: unknown; metadata: unknown } | null> {
    const rows = await this.db
      .select({
        id: acpEvents.id,
        type: acpEvents.type,
        data: acpEvents.data,
        metadata: acpEvents.metadata,
        sessionId: acpEvents.sessionId,
      })
      .from(acpEvents)
      .where(eq(acpEvents.id, eventId))
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
    const rows = await this.db.select().from(acpEvents).where(eq(acpEvents.id, eventId)).limit(1);

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
    type: ACPEvent['type'],
  ): Promise<{ id: number; data: unknown } | null> {
    const last = await this.db
      .select()
      .from(acpEvents)
      .where(and(eq(acpEvents.sessionId, sessionId), eq(acpEvents.type, type)))
      .orderBy(desc(acpEvents.id))
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
    const toDelete = await this.db
      .select({ metadata: acpEvents.metadata })
      .from(acpEvents)
      .where(and(gte(acpEvents.id, eventId), eq(acpEvents.sessionId, sessionId)));

    let deletedTokens = 0;
    for (const e of toDelete) {
      deletedTokens += extractTokens(e.metadata);
    }

    await this.db
      .delete(acpEvents)
      .where(and(gte(acpEvents.id, eventId), eq(acpEvents.sessionId, sessionId)));

    void this.decrementTotalTokens(sessionId, deletedTokens).catch(() => undefined);
  }

  async getEventWithMetadata(
    sessionId: string,
    eventId: number,
  ): Promise<{ id: number; type: string; data: unknown; metadata: unknown } | null> {
    const rows = await this.db
      .select()
      .from(acpEvents)
      .where(and(eq(acpEvents.id, eventId), eq(acpEvents.sessionId, sessionId)))
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
