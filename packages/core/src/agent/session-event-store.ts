import { eq, and, desc } from 'drizzle-orm';
import { acpEvents } from '../db/schema.js';
import type { DbClient } from './acp-session.js';
import type { IEventBus } from './session-manager.js';
import type { ACPEvent } from '@agentctl/shared';

export class SessionEventStore {
  constructor(
    private db: DbClient,
    private eventBus: IEventBus,
  ) {}

  async append(sessionId: string, type: ACPEvent['type'], data: unknown): Promise<number> {
    const inserted = await this.db
      .insert(acpEvents)
      .values({
        sessionId,
        type,
        data: JSON.stringify(data),
      })
      .returning();

    const first = inserted[0];
    this.eventBus.publish({
      ...first,
      createdAt: new Date(first.createdAt),
    });
    return first.id;
  }

  async update(eventId: number, data: unknown): Promise<void> {
    const updated = await this.db
      .update(acpEvents)
      .set({
        data: JSON.stringify(data),
      })
      .where(eq(acpEvents.id, eventId))
      .returning();

    const first = updated[0];
    this.eventBus.publish({
      ...first,
      createdAt: new Date(first.createdAt),
    });
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
