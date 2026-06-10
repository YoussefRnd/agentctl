import { StreamBuffer } from './stream-buffer.js';
import type { SessionEventStore } from './session-event-store.js';
import type { Logger } from '../logger.js';
import { noopLogger } from '../logger.js';

export interface LaunchContext {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  supportsDynamicModel?: boolean;
  supportsDynamicConfig?: boolean;
  resolvedThinkingConfigId?: string;
  resolvedModelConfigId?: string;
}

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
    private eventStore: SessionEventStore,
    private logger: Logger = noopLogger,
  ) {
    this.textBuffer = new StreamBuffer(async () => {
      if (this.messageEventId) {
        const durationMs = this.messageStartTime ? Date.now() - this.messageStartTime : 0;
        const completionTokens = Math.ceil(this.currentMessage.length / 4);
        await this.eventStore.update(
          this.messageEventId,
          { content: this.currentMessage, role: 'provider' },
          { durationMs, completionTokens }
        );
      }
    });

    this.thoughtBuffer = new StreamBuffer(async () => {
      if (this.thoughtEventId) {
        const durationMs = this.thoughtStartTime ? Date.now() - this.thoughtStartTime : 0;
        const completionTokens = Math.ceil(this.currentThought.length / 4);
        await this.eventStore.update(
          this.thoughtEventId,
          { content: this.currentThought, role: 'thought' },
          { durationMs, completionTokens }
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

    const eventId = await this.eventStore.append(
      this.sessionId,
      'text',
      {
        content: text,
        role: 'user',
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
      },
      null,
      promptTokens ? { promptTokens } : undefined
    );
    this.currentParentEventId = eventId;
    return eventId;
  }

  async appendText(text: string): Promise<void> {
    this.currentMessage += text;
    const completionTokens = Math.ceil(this.currentMessage.length / 4);
    if (this.messageEventId) {
      this.textBuffer.append(text);
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
        { durationMs: 0, completionTokens }
      );
    }
  }

  async appendThought(text: string): Promise<void> {
    this.currentThought += text;
    const completionTokens = Math.ceil(this.currentThought.length / 4);
    if (this.thoughtEventId) {
      this.thoughtBuffer.append(text);
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
        { durationMs: 0, completionTokens }
      );
    }
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
        { durationMs: 0 }
      );
    } else if (this.toolCallEventId) {
      const durationMs = Date.now() - (this.toolCallStartTime ?? Date.now());
      await this.eventStore.update(
        this.toolCallEventId,
        call,
        { durationMs }
      );
    }
  }

  async flushAll(): Promise<void> {
    await Promise.all([
      this.textBuffer.flush(),
      this.thoughtBuffer.flush(),
    ]);
  }

  getCurrentParentEventId(): number | null {
    return this.currentParentEventId;
  }

  setCurrentParentEventId(id: number | null) {
    this.currentParentEventId = id;
  }
}
