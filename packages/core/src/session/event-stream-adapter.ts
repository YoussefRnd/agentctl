import { StreamBuffer } from '../acp/transport/stream-buffer.js';
import type { SessionEventStoreLike, SnapshotServiceLike } from '../acp/types.js';
import type { ACPEventDbRow } from '../db/zod-schemas.js';
import type { Logger } from '../logger.js';
import { noopLogger } from '../logger.js';

export class EventStreamAdapter {
  private currentMessage = '';
  private currentThought = '';
  private messageEventId: number | null = null;
  private thoughtEventId: number | null = null;
  private messageStartTime: number | null = null;
  private thoughtStartTime: number | null = null;
  private toolCallStartTime: number | null = null;
  private toolCallEventId: number | null = null;
  private currentParentEventId: number | null = null;

  private textBuffer: StreamBuffer;
  private thoughtBuffer: StreamBuffer;

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
        const completionTokens = Math.ceil(this.currentMessage.length / 4);
        await this.eventStore.updateSilently(
          this.messageEventId,
          { content: this.currentMessage, role: 'provider' },
          { durationMs, completionTokens },
        );
      }
    });

    this.thoughtBuffer = new StreamBuffer(async () => {
      if (this.thoughtEventId) {
        const durationMs = this.thoughtStartTime ? Date.now() - this.thoughtStartTime : 0;
        const completionTokens = Math.ceil(this.currentThought.length / 4);
        await this.eventStore.updateSilently(
          this.thoughtEventId,
          { content: this.currentThought, role: 'thought' },
          { durationMs, completionTokens },
        );
      }
    });
  }

  async startTurn(text: string, attachments?: unknown[], promptTokens?: number): Promise<number> {
    this.currentMessage = '';
    this.currentThought = '';
    this.messageEventId = null;
    this.thoughtEventId = null;
    this.messageStartTime = null;
    this.thoughtStartTime = null;
    this.toolCallStartTime = null;
    this.toolCallEventId = null;
    this.textBuffer.reset();
    this.thoughtBuffer.reset();

    const metadata: Record<string, unknown> = {};
    if (promptTokens) {
      metadata.promptTokens = promptTokens;
    }

    if (this.cwd && this.snapshotService) {
      const snapshotHash = await this.snapshotService.track(this.cwd);
      if (snapshotHash) {
        metadata.snapshotHash = snapshotHash;
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
    return eventId;
  }

  async appendText(text: string): Promise<void> {
    this.currentMessage += text;
    const completionTokens = Math.ceil(this.currentMessage.length / 4);
    if (this.messageEventId) {
      this.textBuffer.append(text);
      this.publishTransient(this.messageEventId, 'text', { content: '', role: 'provider' }, text, {
        durationMs: this.messageStartTime ? Date.now() - this.messageStartTime : 0,
        completionTokens,
      });
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
        { durationMs: 0, completionTokens },
      );
    }
  }

  async appendThought(text: string): Promise<void> {
    this.currentThought += text;
    const completionTokens = Math.ceil(this.currentThought.length / 4);
    if (this.thoughtEventId) {
      this.thoughtBuffer.append(text);
      this.publishTransient(this.thoughtEventId, 'text', { content: '', role: 'thought' }, text, {
        durationMs: this.thoughtStartTime ? Date.now() - this.thoughtStartTime : 0,
        completionTokens,
      });
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
        { durationMs: 0, completionTokens },
      );
    }
  }

  private publishTransient(
    eventId: number,
    type: 'text',
    data: Record<string, unknown>,
    delta: string,
    metadata: Record<string, unknown>,
  ): void {
    const parentId = this.currentParentEventId ?? null;
    const row: ACPEventDbRow = {
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
  getTransientSnapshots(): ACPEventDbRow[] {
    const snapshots: ACPEventDbRow[] = [];
    if (this.messageEventId !== null && this.currentMessage.length > 0) {
      snapshots.push({
        id: this.messageEventId,
        sessionId: this.sessionId,
        parentEventId: this.currentParentEventId ?? null,
        type: 'text',
        data: JSON.stringify({ content: this.currentMessage, role: 'provider' }),
        metadata: JSON.stringify({
          durationMs: this.messageStartTime ? Date.now() - this.messageStartTime : 0,
          completionTokens: Math.ceil(this.currentMessage.length / 4),
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
          completionTokens: Math.ceil(this.currentThought.length / 4),
        }),
        createdAt: new Date(),
      });
    }
    return snapshots;
  }

  async registerToolCall(call: unknown, isUpdate: boolean): Promise<void> {
    if (!isUpdate) {
      await this.flushAll();

      this.currentMessage = '';
      this.currentThought = '';
      this.messageEventId = null;
      const parentId = this.thoughtEventId ?? this.currentParentEventId;
      this.thoughtEventId = null;
      this.messageStartTime = null;
      this.thoughtStartTime = null;

      this.toolCallStartTime = Date.now();
      this.toolCallEventId = await this.eventStore.append(
        this.sessionId,
        'tool_call',
        call,
        parentId,
        { durationMs: 0 },
      );
    } else if (this.toolCallEventId) {
      const durationMs = Date.now() - (this.toolCallStartTime ?? Date.now());
      await this.eventStore.update(this.toolCallEventId, call, { durationMs });
    }
  }

  async flushAll(): Promise<void> {
    await Promise.all([this.textBuffer.flush(), this.thoughtBuffer.flush()]);
  }

  getCurrentParentEventId(): number | null {
    return this.currentParentEventId;
  }

  setCurrentParentEventId(id: number | null) {
    this.currentParentEventId = id;
  }
}
