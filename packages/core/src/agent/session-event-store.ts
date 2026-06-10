import { eq, and, desc } from 'drizzle-orm';
import { acpEvents } from '../db/schema.js';
import type { DbClient } from './acp-session.js';
import type { IEventBus } from './session-manager.js';
import type { ACPEvent } from '@agentctl/shared';

export class SessionEventStore {
  constructor(
    private db: DbClient,
    public eventBus: IEventBus,
  ) {}

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
    return first.id;
  }

  async update(eventId: number, data: unknown, metadata?: unknown): Promise<void> {
    const existing = await this.getEvent(eventId);
    let mergedData = data;
    if (existing && typeof existing.data === 'object' && existing.data !== null && typeof data === 'object' && data !== null) {
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
  }

  async getEvent(eventId: number): Promise<{ id: number; type: string; data: unknown } | null> {
    const rows = await this.db
      .select()
      .from(acpEvents)
      .where(eq(acpEvents.id, eventId))
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
}
