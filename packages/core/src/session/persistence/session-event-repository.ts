import { eq, and, desc, gte, sql } from 'drizzle-orm';
import { sessionEvents, sessions } from '../../db/schema.js';
import type { DbClient } from '../../db/index.js';
import type { IEventBus } from '../contracts.js';
import type {
  SessionEvent,
  SessionEventPayload,
  SessionEventMetadata,
  SessionNotice,
} from '@agentctl/shared';
import type { SessionEventDbRow } from '../../db/zod-schemas.js';
import { sessionEventCodecs } from '../../db/json-codecs.js';
import { cancelRemovedMessageOperations } from './session-operation-reconciliation.js';

import { prepareEventStatements } from './session-event-statements.js';

export const SESSION_CHANGE_RETENTION = 10_000;

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

export class SessionEventRepository {
  private prepared?: ReturnType<typeof prepareEventStatements>;

  private get statements() {
    return (this.prepared ??= prepareEventStatements(this.db, SESSION_CHANGE_RETENTION));
  }
  publishNotice(notice: SessionNotice): void {
    this.eventBus.publish(notice);
  }
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

  /**
   * Publish-only: sends the row to the bus without persisting it (transient
   * live update). When `delta` is provided the payload carries wire-only delta
   * semantics: consumers append it to the existing event instead of replacing.
   */
  publishTransient(event: SessionEventDbRow, delta?: string): void {
    this.eventBus.publish(delta !== undefined ? { ...event, delta } : event);
  }

  async append<T extends SessionEvent['type']>(
    sessionId: string,
    type: T,
    data: SessionEventPayload<T>,
    parentEventId?: number | null,
    metadata?: SessionEventMetadata | null,
  ): Promise<number>;
  async append(
    sessionId: string,
    type: string,
    data: unknown,
    parentEventId?: number | null,
    metadata?: SessionEventMetadata | null,
  ): Promise<number> {
    const validatedData = sessionEventCodecs.validateData(
      type as SessionEvent['type'],
      data as SessionEventPayload<SessionEvent['type']>,
    );
    const validatedMetadata = sessionEventCodecs.validateMetadata(metadata);
    const committed = this.db.transaction(() =>
      this.insertInTransaction(sessionId, type, validatedData, parentEventId, validatedMetadata),
    );
    this.publishCommitted(committed);
    return committed.id;
  }

  /** Uses this repository's connection; caller must own its synchronous transaction. */
  insertInTransaction(
    sessionId: string,
    type: string,
    data: unknown,
    parentEventId?: number | null,
    metadata?: SessionEventMetadata | null,
  ): SessionEventDbRow & { sequence: number } {
    const validated = sessionEventCodecs.validateData(
      type as SessionEvent['type'],
      data as SessionEventPayload<SessionEvent['type']>,
    );
    const value = validated as Record<string, unknown>;
    const first = this.statements.insert.get({
      sessionId,
      type,
      clientMessageId:
        type === 'text' && value.role === 'user' && typeof value.clientMessageId === 'string'
          ? value.clientMessageId
          : null,
      data: JSON.stringify(validated),
      parentEventId: parentEventId ?? null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });
    const change = this.recordChange(sessionId, first.id);
    const values = { sessionId, tokens: extractTokens(metadata), now: new Date() };
    if (type === 'text')
      this.statements.textActivity.run({ ...values, activityAt: new Date(first.createdAt) });
    else this.statements.tokens.run(values);
    return { ...first, createdAt: new Date(first.createdAt), sequence: change.sequence };
  }

  private recordChange(sessionId: string, eventId: number) {
    const change = this.statements.change.get({ sessionId, eventId });
    const cutoff = this.statements.cutoff.get({ sessionId });
    if (cutoff) this.statements.prune.run({ sessionId, sequence: cutoff.sequence });
    return change;
  }

  publishCommitted(event: SessionEventDbRow & { sequence: number }): void {
    this.eventBus.publish(event);
  }

  async update(
    eventId: number,
    data: unknown,
    metadata?: SessionEventMetadata | null,
    clearFields: readonly string[] = [],
  ): Promise<void> {
    await this.performUpdate(eventId, data, metadata, true, clearFields);
  }

  async updateSilently(
    eventId: number,
    data: unknown,
    metadata?: SessionEventMetadata | null,
  ): Promise<void> {
    await this.performUpdate(eventId, data, metadata, false);
  }

  private async performUpdate(
    eventId: number,
    data: unknown,
    metadata?: SessionEventMetadata | null,
    shouldPublish = true,
    clearFields: readonly string[] = [],
  ): Promise<void> {
    const committed = this.db.transaction(() =>
      this.updateInTransaction(eventId, data, metadata, clearFields),
    );
    if (shouldPublish && committed) this.publishCommitted(committed);
  }

  /** Uses this repository's connection; caller must own its synchronous transaction. */
  updateInTransaction(
    eventId: number,
    data: unknown,
    metadata?: SessionEventMetadata | null,
    clearFields: readonly string[] = [],
  ): (SessionEventDbRow & { sequence: number }) | undefined {
    const row = this.statements.event.get({ eventId });
    if (!row) return undefined;
    const existingData = sessionEventCodecs.parseData(row.type, row.data);
    const existingMetadata = sessionEventCodecs.parseMetadata(row.metadata);
    const mergedMetadata =
      metadata === undefined
        ? existingMetadata
        : metadata === null
          ? null
          : {
              ...existingMetadata,
              ...metadata,
            };
    let mergedData = data;
    if (existingData && typeof existingData === 'object' && data && typeof data === 'object') {
      const supplied = Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined),
      );
      mergedData = { ...existingData, ...supplied };
      for (const field of clearFields) delete (mergedData as Record<string, unknown>)[field];
    }
    const validatedData = sessionEventCodecs.validateData(
      row.type,
      mergedData as SessionEventPayload<SessionEvent['type']>,
    );
    const validatedMetadata = sessionEventCodecs.validateMetadata(mergedMetadata);
    const first = this.statements.update.get({
      eventId,
      data: JSON.stringify(validatedData),
      metadata: validatedMetadata ? JSON.stringify(validatedMetadata) : null,
    })!;
    const change = this.recordChange(row.sessionId, eventId);
    const delta = extractTokens(validatedMetadata) - extractTokens(existingMetadata);
    if (delta)
      this.statements.tokens.run({ sessionId: row.sessionId, tokens: delta, now: new Date() });
    return { ...first, createdAt: new Date(first.createdAt), sequence: change.sequence };
  }

  async findMessage(sessionId: string, role: string, messageId: string, nativeSessionId?: string) {
    const row = this.db
      .select()
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.sessionId, sessionId),
          eq(sessionEvents.type, 'text'),
          sql`json_extract(${sessionEvents.data}, '$.role') = ${role}`,
          sql`json_extract(${sessionEvents.data}, '$.messageId') = ${messageId}`,
          nativeSessionId
            ? sql`json_extract(${sessionEvents.metadata}, '$.nativeSessionId') = ${nativeSessionId}`
            : sql`json_extract(${sessionEvents.metadata}, '$.nativeSessionId') IS NULL`,
        ),
      )
      .orderBy(desc(sessionEvents.id))
      .get();
    if (!row) return undefined;
    const data = sessionEventCodecs.parseData('text', row.data) as SessionEventPayload<'text'>;
    return {
      eventId: row.id,
      text: data.content ?? data.text ?? '',
      startedAt: row.createdAt.getTime(),
      parentEventId: row.parentEventId,
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

    const parsedData = sessionEventCodecs.parseData(first.type, first.data);

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

    const parsedData = sessionEventCodecs.parseData(first.type, first.data);

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
    return this.db.transaction((tx) => {
      const rows = tx
        .select()
        .from(sessionEvents)
        .where(and(gte(sessionEvents.id, eventId), eq(sessionEvents.sessionId, sessionId)))
        .orderBy(sessionEvents.id)
        .all();
      tx.delete(sessionEvents)
        .where(and(gte(sessionEvents.id, eventId), eq(sessionEvents.sessionId, sessionId)))
        .run();
      cancelRemovedMessageOperations(tx, sessionId);
      // Deleted pointers force a reconnect snapshot, including an empty history.
      this.recordChange(sessionId, eventId);
      const tokens = rows.reduce((sum, row) => sum + extractTokens(row.metadata), 0);
      tx.update(sessions)
        .set({ totalTokens: sql`MAX(0, ${sessions.totalTokens} - ${tokens})` })
        .where(eq(sessions.id, sessionId))
        .run();
      return rows;
    });
  }

  async restoreEvents(sessionId: string, rows: SessionEventDbRow[]): Promise<void> {
    if (!rows.length) return;
    this.db.transaction((tx) => {
      for (const row of rows) {
        if (row.sessionId !== sessionId) throw new Error('Cannot restore another session history');
        const data = sessionEventCodecs.parseData(
          row.type,
          row.data,
        ) as SessionEventPayload<'text'>;
        tx.insert(sessionEvents)
          .values({
            ...row,
            type: row.type as SessionEvent['type'],
            clientMessageId:
              row.type === 'text' && data.role === 'user' ? data.clientMessageId : null,
            createdAt: new Date(row.createdAt),
          })
          .run();
        this.recordChange(sessionId, row.id);
      }
      const tokens = rows.reduce((sum, row) => sum + extractTokens(row.metadata), 0);
      tx.update(sessions)
        .set({ totalTokens: sql`MAX(0, ${sessions.totalTokens} + ${tokens})` })
        .where(eq(sessions.id, sessionId))
        .run();
    });
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

    const parsedData = sessionEventCodecs.parseData(first.type, first.data);
    const parsedMetadata = sessionEventCodecs.parseMetadata(first.metadata);

    return {
      id: first.id,
      type: first.type,
      data: parsedData,
      metadata: parsedMetadata,
    };
  }
}
