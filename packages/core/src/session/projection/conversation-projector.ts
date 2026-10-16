import { StreamBuffer } from '../stream-buffer.js';
import type { SessionEventRepositoryLike, SnapshotServiceLike } from '../contracts.js';
import type { SessionEventDbRow } from '../../db/zod-schemas.js';
import type { Logger } from '../../logger.js';
import { noopLogger } from '../../logger.js';
import { sessionEventToolCallDataSchema, type SessionEventPayload } from '@agentctl/shared';

export interface TurnStart {
  eventId: number;
  snapshotPromise: Promise<string | undefined>;
}

export class ConversationProjector {
  private identifiedMessages = new Map<
    string,
    { eventId: number; text: string; startedAt: number; parentEventId: number | null }
  >();
  private replayUser: { eventId: number; text: string; messageId?: string } | undefined;
  private activeAttemptId: string | undefined;
  private currentMessage = '';
  private currentThought = '';
  private currentMessageId: string | undefined;
  private currentThoughtId: string | undefined;
  private messageEventId: number | null = null;
  private thoughtEventId: number | null = null;
  private messageStartTime: number | null = null;
  private thoughtStartTime: number | null = null;
  // IDs are session-scoped. Retain bounded snapshots across turns so late
  // background updates and content after completion update the original row.
  private activeToolCalls = new Map<
    string,
    { eventId: number; startTime: number; inFlight: boolean; endTime?: number; status?: string }
  >();
  private lastToolCallStartTime: number | null = null;
  private lastToolCallEventId: number | null = null;
  private currentParentEventId: number | null = null;
  private pendingUserEcho: { eventId: number; messageId?: string; text: string } | undefined;
  private messageParentEventId: number | null = null;
  private thoughtParentEventId: number | null = null;

  private textBuffer: StreamBuffer;
  private thoughtBuffer: StreamBuffer;

  private pendingTextDelta = '';
  private pendingThoughtDelta = '';
  private textDeltaTimer: NodeJS.Timeout | null = null;
  private thoughtDeltaTimer: NodeJS.Timeout | null = null;
  private transientCoalesceMs = 50;

  constructor(
    private sessionId: string,
    private eventRepository: SessionEventRepositoryLike,
    private logger: Logger = noopLogger,
    private cwd?: string,
    private snapshotService?: SnapshotServiceLike,
  ) {
    this.textBuffer = new StreamBuffer(
      async () => {
        if (this.messageEventId) {
          const durationMs = this.messageStartTime ? Date.now() - this.messageStartTime : 0;
          await this.eventRepository.updateSilently(
            this.messageEventId,
            { content: this.currentMessage, role: 'provider' },
            { durationMs },
          );
        }
      },
      500,
      1000,
      1000,
      (error) => this.logger.error(error, 'Failed to persist text stream'),
    );

    this.thoughtBuffer = new StreamBuffer(
      async () => {
        if (this.thoughtEventId) {
          const durationMs = this.thoughtStartTime ? Date.now() - this.thoughtStartTime : 0;
          await this.eventRepository.updateSilently(
            this.thoughtEventId,
            { content: this.currentThought, role: 'thought' },
            { durationMs },
          );
        }
      },
      500,
      1000,
      1000,
      (error) => this.logger.error(error, 'Failed to persist thought stream'),
    );
  }

  async startTurn(
    text: string,
    attachments?: NonNullable<SessionEventPayload<'text'>['attachments']>,
    promptTokens?: number,
    clientMessageId?: string,
    attachmentIds?: string[],
    acceptedEventId?: number,
    attemptId?: string,
  ): Promise<TurnStart> {
    await this.flushAll();
    this.activeAttemptId = attemptId;
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
    this.textBuffer.reset();
    this.thoughtBuffer.reset();

    const metadata: Record<string, unknown> = attemptId ? { attemptId } : {};
    if (promptTokens !== undefined) {
      metadata.promptTokens = promptTokens;
    }

    const userPayload: SessionEventPayload<'text'> = {
      content: text,
      role: 'user',
      clientMessageId,
      attachmentIds,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
    };

    const eventId =
      acceptedEventId ??
      (await this.eventRepository.append(
        this.sessionId,
        'text',
        userPayload,
        null,
        Object.keys(metadata).length > 0 ? metadata : undefined,
      ));
    this.currentParentEventId = eventId;
    this.pendingUserEcho = { eventId, text: '' };
    if (acceptedEventId)
      await this.eventRepository.update(
        eventId,
        { ...userPayload, deliveryStatus: 'accepted' },
        metadata,
        ['deliveryError'],
      );

    const snapshotPromise = (async (): Promise<string | undefined> => {
      if (!this.cwd || !this.snapshotService) return undefined;
      try {
        const hash = await this.snapshotService.track(this.cwd);
        if (hash) {
          await this.eventRepository.updateSilently(eventId, userPayload, {
            ...metadata,
            snapshotHash: hash,
          });
        }
        return hash;
      } catch (error) {
        this.logger.error(error, 'Failed to capture turn-start snapshot');
        return undefined;
      }
    })();

    return { eventId, snapshotPromise };
  }

  clearPendingUserMessage(): void {
    this.pendingUserEcho = undefined;
  }

  async acceptUserMessage(messageId: string): Promise<void> {
    const echo = this.pendingUserEcho;
    if (!echo) return;
    echo.messageId = messageId;
    await this.eventRepository.update(echo.eventId, { messageId });
    const row = await this.eventRepository.getEvent(echo.eventId);
    const content =
      row?.data &&
      typeof row.data === 'object' &&
      'content' in row.data &&
      typeof row.data.content === 'string'
        ? row.data.content
        : '';
    this.rememberMessage('user', messageId, echo.eventId, content, Date.now());
  }

  async appendUserText(
    text: string,
    messageId?: string,
    operation?: 'append' | 'replace',
  ): Promise<void> {
    const previous = messageId ? await this.findMessage('user', messageId) : undefined;
    const echo = this.pendingUserEcho;
    if (
      echo &&
      (!previous || previous.eventId === echo.eventId) &&
      (!echo.messageId || !messageId || echo.messageId === messageId)
    ) {
      echo.messageId ??= messageId;
      echo.text = operation === 'replace' ? text : echo.text + text;
      await this.eventRepository.update(echo.eventId, {
        content: echo.text,
        role: 'user',
        messageId: echo.messageId,
      });
      this.rememberMessage('user', echo.messageId, echo.eventId, echo.text, Date.now());
      return;
    }
    if (previous) {
      previous.text = operation === 'replace' ? text : previous.text + text;
      if (this.replayUser?.eventId === previous.eventId) this.replayUser.text = previous.text;
      await this.eventRepository.update(previous.eventId, {
        content: previous.text,
        role: 'user',
        messageId,
      });
      return;
    }
    if (this.replayUser && (!messageId || this.replayUser.messageId === messageId)) {
      this.replayUser.text = operation === 'replace' ? text : this.replayUser.text + text;
      await this.eventRepository.update(this.replayUser.eventId, {
        content: this.replayUser.text,
        role: 'user',
      });
      return;
    }
    if (echo?.messageId && messageId && echo.messageId !== messageId) {
      const eventId = await this.eventRepository.append(
        this.sessionId,
        'text',
        { content: text, role: 'user', messageId },
        null,
      );
      this.rememberMessage('user', messageId, eventId, text, Date.now());
      return;
    }
    await this.flushAll();
    this.currentMessage = '';
    this.currentThought = '';
    this.currentMessageId = undefined;
    this.currentThoughtId = undefined;
    this.messageEventId = null;
    this.thoughtEventId = null;
    this.textBuffer.reset();
    this.thoughtBuffer.reset();
    const eventId = await this.eventRepository.append(
      this.sessionId,
      'text',
      { content: text, role: 'user', messageId },
      null,
    );
    this.currentParentEventId = eventId;
    this.replayUser = { eventId, text, messageId };
    this.rememberMessage('user', messageId, eventId, text, Date.now());
  }

  async appendText(
    text: string,
    messageId?: string,
    operation: 'append' | 'replace' = 'append',
  ): Promise<void> {
    this.replayUser = undefined;
    if (messageId && messageId !== this.currentMessageId) {
      await this.flushAll();
      this.rememberMessage(
        'provider',
        this.currentMessageId,
        this.messageEventId,
        this.currentMessage,
        this.messageStartTime,
      );
      const previous = await this.findMessage('provider', messageId);
      this.currentMessage = previous?.text ?? '';
      this.messageEventId = previous?.eventId ?? null;
      this.messageStartTime = previous?.startedAt ?? null;
      this.messageParentEventId = previous?.parentEventId ?? this.currentParentEventId;
      this.textBuffer.reset();
    }
    if (messageId) this.currentMessageId = messageId;

    if (operation === 'replace') {
      await this.flushAll();
      this.textBuffer.reset();
      this.currentMessage = text;
      if (this.messageEventId) {
        const durationMs = this.messageStartTime ? Date.now() - this.messageStartTime : 0;
        await this.eventRepository.update(
          this.messageEventId,
          { content: this.currentMessage, role: 'provider' },
          { durationMs },
        );
        this.rememberMessage(
          'provider',
          messageId,
          this.messageEventId,
          this.currentMessage,
          this.messageStartTime,
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
      this.messageParentEventId = this.currentParentEventId;
      this.messageEventId = await this.eventRepository.append(
        this.sessionId,
        'text',
        {
          content: this.currentMessage,
          role: 'provider',
          messageId,
        },
        this.currentParentEventId,
        { ...(this.activeAttemptId ? { attemptId: this.activeAttemptId } : {}), durationMs: 0 },
      );
    }
    this.rememberMessage(
      'provider',
      messageId,
      this.messageEventId,
      this.currentMessage,
      this.messageStartTime,
    );
  }

  async appendThought(
    text: string,
    messageId?: string,
    operation: 'append' | 'replace' = 'append',
  ): Promise<void> {
    if (messageId && messageId !== this.currentThoughtId) {
      await this.flushAll();
      this.rememberMessage(
        'thought',
        this.currentThoughtId,
        this.thoughtEventId,
        this.currentThought,
        this.thoughtStartTime,
      );
      const previous = await this.findMessage('thought', messageId);
      this.currentThought = previous?.text ?? '';
      this.thoughtEventId = previous?.eventId ?? null;
      this.thoughtStartTime = previous?.startedAt ?? null;
      this.thoughtParentEventId = previous?.parentEventId ?? this.currentParentEventId;
      this.thoughtBuffer.reset();
    }
    if (messageId) this.currentThoughtId = messageId;

    if (operation === 'replace') {
      await this.flushAll();
      this.thoughtBuffer.reset();
      this.currentThought = text;
      if (this.thoughtEventId) {
        const durationMs = this.thoughtStartTime ? Date.now() - this.thoughtStartTime : 0;
        await this.eventRepository.update(
          this.thoughtEventId,
          { content: this.currentThought, role: 'thought' },
          { durationMs },
        );
        this.rememberMessage(
          'thought',
          messageId,
          this.thoughtEventId,
          this.currentThought,
          this.thoughtStartTime,
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
      this.thoughtParentEventId = this.currentParentEventId;
      this.thoughtEventId = await this.eventRepository.append(
        this.sessionId,
        'text',
        {
          content: this.currentThought,
          role: 'thought',
          messageId,
        },
        this.currentParentEventId,
        { ...(this.activeAttemptId ? { attemptId: this.activeAttemptId } : {}), durationMs: 0 },
      );
    }
    this.rememberMessage(
      'thought',
      messageId,
      this.thoughtEventId,
      this.currentThought,
      this.thoughtStartTime,
    );
  }

  private async findMessage(role: string, id: string) {
    const key = role + ':' + id;
    const found =
      this.identifiedMessages.get(key) ??
      (await this.eventRepository.findMessage?.(this.sessionId, role, id));
    if (found) this.identifiedMessages.set(key, found);
    return found;
  }

  private rememberMessage(
    role: string,
    id: string | undefined,
    eventId: number | null,
    text: string,
    startedAt: number | null,
  ): void {
    if (!id || eventId === null) return;
    this.identifiedMessages.set(role + ':' + id, {
      eventId,
      text,
      startedAt: startedAt ?? Date.now(),
      parentEventId:
        this.identifiedMessages.get(role + ':' + id)?.parentEventId ?? this.currentParentEventId,
    });
    if (this.identifiedMessages.size > 256)
      this.identifiedMessages.delete(this.identifiedMessages.keys().next().value!);
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
    const parentId =
      data.role === 'thought' ? this.thoughtParentEventId : this.messageParentEventId;
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
      this.eventRepository.publishTransient(row, delta);
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
        parentEventId: this.messageParentEventId,
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
        parentEventId: this.thoughtParentEventId,
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
    clearFields: readonly string[] = [],
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
      const timed = toolCallId ? this.activeToolCalls.get(toolCallId) : undefined;
      if (timed && status) {
        timed.inFlight = status === 'pending' || status === 'in_progress';
        if (timed.inFlight) timed.endTime = undefined;
        else if (status !== timed.status || timed.endTime === undefined) timed.endTime = Date.now();
        timed.status = status;
      }
      const durationMs = Math.max(0, (timed?.endTime ?? Date.now()) - tracked.startTime);
      let persistedCall = call;
      if (contentOperation === 'append' && Array.isArray(callObj.content)) {
        const existing = await this.eventRepository.getEvent(tracked.eventId);
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
      if (clearFields.length)
        await this.eventRepository.update(
          tracked.eventId,
          persistedCall,
          { durationMs },
          clearFields,
        );
      else await this.eventRepository.update(tracked.eventId, persistedCall, { durationMs });
      if (status && status !== 'pending' && status !== 'in_progress') {
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
    const eventId = await this.eventRepository.append(
      this.sessionId,
      'tool_call',
      sessionEventToolCallDataSchema.parse(callObj),
      parentId,
      {
        durationMs: 0,
      },
    );

    const inFlight = !status || status === 'pending' || status === 'in_progress';
    if (toolCallId) {
      this.activeToolCalls.set(toolCallId, {
        eventId,
        startTime,
        inFlight,
        status,
        endTime: inFlight ? undefined : startTime,
      });
      if (this.activeToolCalls.size > 256) {
        const oldest = this.activeToolCalls.keys().next().value;
        if (oldest) {
          const evicted = this.activeToolCalls.get(oldest)!;
          if (evicted.inFlight) {
            await this.eventRepository.update(
              evicted.eventId,
              { status: 'unknown' },
              { durationMs: Math.max(0, Date.now() - evicted.startTime) },
            );
          }
          this.activeToolCalls.delete(oldest);
        }
      }
    }
    if (inFlight) {
      this.lastToolCallStartTime = startTime;
      this.lastToolCallEventId = eventId;
    }
  }

  async finalizeInFlightToolCalls(
    status: 'unknown' | 'cancelled' | 'interrupted' | 'failed' = 'unknown',
  ): Promise<void> {
    const now = Date.now();
    for (const [toolCallId, tracked] of this.activeToolCalls.entries()) {
      if (!tracked.inFlight) continue;
      const durationMs = Math.max(0, now - tracked.startTime);
      await this.eventRepository.update(tracked.eventId, { toolCallId, status }, { durationMs });
      tracked.inFlight = false;
      tracked.endTime = now;
      tracked.status = status;
    }
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
