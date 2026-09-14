import { StreamBuffer } from './stream-buffer.js';
import type { SessionEventStoreLike, SnapshotServiceLike } from './contracts.js';
import type { SessionEventDbRow } from '../db/zod-schemas.js';
import type { Logger } from '../logger.js';
import { noopLogger } from '../logger.js';
import { sessionEventToolCallDataSchema, type SessionEventPayload } from '@agentctl/shared';

export interface TurnStart {
  eventId: number;
  snapshotHash?: string;
}

export class EventStreamAdapter {
  private currentMessage = '';
  private currentThought = '';
  private currentMessageId: string | undefined;
  private currentThoughtId: string | undefined;
  private messageEventId: number | null = null;
  private thoughtEventId: number | null = null;
  private messageStartTime: number | null = null;
  private thoughtStartTime: number | null = null;
  private activeToolCalls = new Map<string, { eventId: number; startTime: number }>();
  private lastToolCallStartTime: number | null = null;
  private lastToolCallEventId: number | null = null;
  private currentParentEventId: number | null = null;

  private textBuffer: StreamBuffer;
  private thoughtBuffer: StreamBuffer;

  private pendingTextDelta = '';
  private pendingThoughtDelta = '';
  private textDeltaTimer: NodeJS.Timeout | null = null;
  private thoughtDeltaTimer: NodeJS.Timeout | null = null;
  private transientCoalesceMs = 50;

  constructor(
    private sessionId: string,
    private eventStore: SessionEventStoreLike,
    private logger: Logger = noopLogger,
    private cwd?: string,
    private snapshotService?: SnapshotServiceLike,
  ) {
    this.textBuffer = new StreamBuffer(async () => {
      if (this.messageEventId) {
        const durationMs = this.messageStartTime ? Date.now() - this.messageStartTime : 0;
        await this.eventStore.updateSilently(
          this.messageEventId,
          { content: this.currentMessage, role: 'provider' },
          { durationMs },
        );
      }
    });

    this.thoughtBuffer = new StreamBuffer(async () => {
      if (this.thoughtEventId) {
        const durationMs = this.thoughtStartTime ? Date.now() - this.thoughtStartTime : 0;
        await this.eventStore.updateSilently(
          this.thoughtEventId,
          { content: this.currentThought, role: 'thought' },
          { durationMs },
        );
      }
    });
  }

  async startTurn(
    text: string,
    attachments?: NonNullable<SessionEventPayload<'text'>['attachments']>,
    promptTokens?: number,
  ): Promise<TurnStart> {
    this.flushTextDelta();
    this.flushThoughtDelta();
    this.currentMessage = '';
    this.currentThought = '';
    this.currentMessageId = undefined;
    this.currentThoughtId = undefined;
    this.messageEventId = null;
    this.thoughtEventId = null;
    this.messageStartTime = null;
    this.thoughtStartTime = null;
    this.lastToolCallStartTime = null;
    this.lastToolCallEventId = null;
    this.activeToolCalls.clear();
    this.textBuffer.reset();
    this.thoughtBuffer.reset();

    const metadata: Record<string, unknown> = {};
    if (promptTokens !== undefined) {
      metadata.promptTokens = promptTokens;
    }

    let snapshotHash: string | undefined;
    if (this.cwd && this.snapshotService) {
      try {
        snapshotHash = await this.snapshotService.track(this.cwd);
        if (snapshotHash) {
          metadata.snapshotHash = snapshotHash;
        }
      } catch (error) {
        this.logger.error(error, 'Failed to capture turn-start snapshot');
      }
    }

    const eventId = await this.eventStore.append(
      this.sessionId,
      'text',
      {
        content: text,
        role: 'user',
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
      },
      null,
      Object.keys(metadata).length > 0 ? metadata : undefined,
    );
    this.currentParentEventId = eventId;
    return { eventId, snapshotHash };
  }

  async appendText(
    text: string,
    messageId?: string,
    operation: 'append' | 'replace' = 'append',
  ): Promise<void> {
    if (messageId && this.currentMessageId && messageId !== this.currentMessageId) {
      await this.flushAll();
      this.currentMessage = '';
      this.messageEventId = null;
      this.messageStartTime = null;
      this.textBuffer.reset();
    }
    if (messageId) this.currentMessageId = messageId;

    if (operation === 'replace') {
      this.currentMessage = text;
      if (this.messageEventId) {
        const durationMs = this.messageStartTime ? Date.now() - this.messageStartTime : 0;
        await this.eventStore.update(
          this.messageEventId,
          { content: this.currentMessage, role: 'provider' },
          { durationMs },
        );
        return;
      }
    } else {
      this.currentMessage += text;
    }
    if (this.messageEventId) {
      this.textBuffer.append(text);
      this.pendingTextDelta += text;
      if (this.pendingTextDelta.length >= 200) {
        this.flushTextDelta();
      } else if (!this.textDeltaTimer) {
        this.textDeltaTimer = setTimeout(() => {
          this.flushTextDelta();
        }, this.transientCoalesceMs);
      }
    } else {
      this.messageStartTime = Date.now();
      this.messageEventId = await this.eventStore.append(
        this.sessionId,
        'text',
        {
          content: this.currentMessage,
          role: 'provider',
        },
        this.currentParentEventId,
        { durationMs: 0 },
      );
    }
  }

  async appendThought(
    text: string,
    messageId?: string,
    operation: 'append' | 'replace' = 'append',
  ): Promise<void> {
    if (messageId && this.currentThoughtId && messageId !== this.currentThoughtId) {
      await this.flushAll();
      this.currentThought = '';
      this.thoughtEventId = null;
      this.thoughtStartTime = null;
      this.thoughtBuffer.reset();
    }
    if (messageId) this.currentThoughtId = messageId;

    if (operation === 'replace') {
      this.currentThought = text;
      if (this.thoughtEventId) {
        const durationMs = this.thoughtStartTime ? Date.now() - this.thoughtStartTime : 0;
        await this.eventStore.update(
          this.thoughtEventId,
          { content: this.currentThought, role: 'thought' },
          { durationMs },
        );
        return;
      }
    } else {
      this.currentThought += text;
    }
    if (this.thoughtEventId) {
      this.thoughtBuffer.append(text);
      this.pendingThoughtDelta += text;
      if (this.pendingThoughtDelta.length >= 200) {
        this.flushThoughtDelta();
      } else if (!this.thoughtDeltaTimer) {
        this.thoughtDeltaTimer = setTimeout(() => {
          this.flushThoughtDelta();
        }, this.transientCoalesceMs);
      }
    } else {
      this.thoughtStartTime = Date.now();
      this.thoughtEventId = await this.eventStore.append(
        this.sessionId,
        'text',
        {
          content: this.currentThought,
          role: 'thought',
        },
        this.currentParentEventId,
        { durationMs: 0 },
      );
    }
  }

  private flushTextDelta(): void {
    if (this.textDeltaTimer) {
      clearTimeout(this.textDeltaTimer);
      this.textDeltaTimer = null;
    }
    if (!this.pendingTextDelta || this.messageEventId === null) return;
    const delta = this.pendingTextDelta;
    this.pendingTextDelta = '';
    const durationMs = this.messageStartTime ? Date.now() - this.messageStartTime : 0;
    this.publishTransient(this.messageEventId, 'text', { content: '', role: 'provider' }, delta, {
      durationMs,
    });
  }

  private flushThoughtDelta(): void {
    if (this.thoughtDeltaTimer) {
      clearTimeout(this.thoughtDeltaTimer);
      this.thoughtDeltaTimer = null;
    }
    if (!this.pendingThoughtDelta || this.thoughtEventId === null) return;
    const delta = this.pendingThoughtDelta;
    this.pendingThoughtDelta = '';
    const durationMs = this.thoughtStartTime ? Date.now() - this.thoughtStartTime : 0;
    this.publishTransient(this.thoughtEventId, 'text', { content: '', role: 'thought' }, delta, {
      durationMs,
    });
  }

  private publishTransient(
    eventId: number,
    type: 'text',
    data: Record<string, unknown>,
    delta: string,
    metadata: Record<string, unknown>,
  ): void {
    const parentId = this.currentParentEventId ?? null;
    const row: SessionEventDbRow = {
      id: eventId,
      sessionId: this.sessionId,
      parentEventId: parentId,
      type,
      data: JSON.stringify(data),
      metadata: JSON.stringify(metadata),
      createdAt: new Date(),
    };
    try {
      this.eventStore.publishTransient(row, delta);
    } catch (err: unknown) {
      this.logger.error(err, 'Failed to publish transient streaming event');
    }
  }

  /**
   * Full-content snapshots of in-flight streaming events, used by the SSE
   * layer to resync clients after a replay (replay rows may lag the live
   * transient stream). Guaranteed >= the last persisted row for the same id.
   */
  getTransientSnapshots(): SessionEventDbRow[] {
    const snapshots: SessionEventDbRow[] = [];
    if (this.messageEventId !== null && this.currentMessage.length > 0) {
      snapshots.push({
        id: this.messageEventId,
        sessionId: this.sessionId,
        parentEventId: this.currentParentEventId ?? null,
        type: 'text',
        data: JSON.stringify({ content: this.currentMessage, role: 'provider' }),
        metadata: JSON.stringify({
          durationMs: this.messageStartTime ? Date.now() - this.messageStartTime : 0,
        }),
        createdAt: new Date(),
      });
    }
    if (this.thoughtEventId !== null && this.currentThought.length > 0) {
      snapshots.push({
        id: this.thoughtEventId,
        sessionId: this.sessionId,
        parentEventId: this.currentParentEventId ?? null,
        type: 'text',
        data: JSON.stringify({ content: this.currentThought, role: 'thought' }),
        metadata: JSON.stringify({
          durationMs: this.thoughtStartTime ? Date.now() - this.thoughtStartTime : 0,
        }),
        createdAt: new Date(),
      });
    }
    return snapshots;
  }

  async upsertToolCall(
    call: unknown,
    contentOperation: 'replace' | 'append' = 'replace',
  ): Promise<void> {
    const callObj =
      typeof call === 'object' && call !== null ? (call as Record<string, unknown>) : {};
    const toolCallId =
      typeof callObj.toolCallId === 'string' && callObj.toolCallId.trim()
        ? callObj.toolCallId.trim()
        : undefined;

    const tracked =
      (toolCallId ? this.activeToolCalls.get(toolCallId) : undefined) ??
      (!toolCallId && this.lastToolCallEventId != null && this.lastToolCallStartTime != null
        ? { eventId: this.lastToolCallEventId, startTime: this.lastToolCallStartTime }
        : undefined);
    const status = typeof callObj.status === 'string' ? callObj.status : undefined;

    if (tracked) {
      const durationMs = Math.max(0, Date.now() - tracked.startTime);
      let persistedCall = call;
      if (contentOperation === 'append' && Array.isArray(callObj.content)) {
        const existing = await this.eventStore.getEvent(tracked.eventId);
        const existingData =
          existing?.data && typeof existing.data === 'object'
            ? (existing.data as Record<string, unknown>)
            : {};
        persistedCall = {
          ...callObj,
          content: [
            ...(Array.isArray(existingData.content) ? existingData.content : []),
            ...callObj.content,
          ],
        };
      }
      await this.eventStore.update(tracked.eventId, persistedCall, { durationMs });
      if (status === 'completed' || status === 'failed') {
        if (toolCallId) this.activeToolCalls.delete(toolCallId);
        if (this.lastToolCallEventId === tracked.eventId) {
          this.lastToolCallEventId = null;
          this.lastToolCallStartTime = null;
        }
      }
      return;
    }

    await this.flushAll();
    this.currentMessage = '';
    this.currentThought = '';
    this.currentMessageId = undefined;
    this.currentThoughtId = undefined;
    this.messageEventId = null;
    const parentId = this.thoughtEventId ?? this.currentParentEventId;
    this.thoughtEventId = null;
    this.messageStartTime = null;
    this.thoughtStartTime = null;

    const startTime = Date.now();
    const eventId = await this.eventStore.append(
      this.sessionId,
      'tool_call',
      sessionEventToolCallDataSchema.parse(callObj),
      parentId,
      {
        durationMs: 0,
      },
    );

    if (status !== 'completed' && status !== 'failed') {
      this.lastToolCallStartTime = startTime;
      this.lastToolCallEventId = eventId;
      if (toolCallId) this.activeToolCalls.set(toolCallId, { eventId, startTime });
    }
  }

  async finalizeInFlightToolCalls(): Promise<void> {
    const now = Date.now();
    for (const [toolCallId, tracked] of this.activeToolCalls.entries()) {
      const durationMs = Math.max(0, now - tracked.startTime);
      await this.eventStore.update(
        tracked.eventId,
        { toolCallId, status: 'completed' },
        { durationMs },
      );
    }
    this.activeToolCalls.clear();
    this.lastToolCallEventId = null;
    this.lastToolCallStartTime = null;
  }

  async flushAll(): Promise<void> {
    this.flushTextDelta();
    this.flushThoughtDelta();
    await Promise.all([this.textBuffer.flush(), this.thoughtBuffer.flush()]);
  }

  getCurrentParentEventId(): number | null {
    return this.currentParentEventId;
  }

  setCurrentParentEventId(id: number | null) {
    this.currentParentEventId = id;
  }
}
