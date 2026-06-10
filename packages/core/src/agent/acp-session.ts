import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { sessions, acpEvents } from '../db/schema.js';
import { eq, asc } from 'drizzle-orm';
import type { createDatabase } from '../db/index.js';
import { type Logger, noopLogger } from '../logger.js';
import type { SessionEventStore } from './session-event-store.js';
import type {
  DomainPermissionRequest,
  DomainPermissionResponse,
  DomainAgentEvent,
  AgentRuntimeHandle,
} from './acp-transport.js';

import { StreamBuffer } from './stream-buffer.js';
import type { SessionStateMachine } from './session-state-machine.js';

export type DbClient = ReturnType<typeof createDatabase>;

export class ACPSession {
  public acpSessionId: string | null = null;
  private pendingApprovals = new Map<string, (response: DomainPermissionResponse) => void>();
  private pendingRequests = new Map<string, DomainPermissionRequest>();
  private historyHydrated = false;
  private isStopped = false;
  private stopKind: 'idle' | 'error' | null = null;

  private currentParentEventId: number | null = null;
  private turnStartTime: number | null = null;
  private thoughtStartTime: number | null = null;
  private toolCallStartTime: number | null = null;
  private messageStartTime: number | null = null;

  private textBuffer = new StreamBuffer(async () => {
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

  private thoughtBuffer = new StreamBuffer(async () => {
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

  public async flushAll(): Promise<void> {
    await Promise.all([
      this.textBuffer.flush(),
      this.thoughtBuffer.flush(),
    ]);
  }

  get isDead(): boolean {
    return this.isStopped;
  }

  constructor(
    public sessionId: string,
    private runtimeHandle: AgentRuntimeHandle,
    private db: DbClient,
    private eventStore: SessionEventStore,
    private cwd: string,
    private stateMachine?: SessionStateMachine,
    private logger: Logger = noopLogger,
  ) {
    this.acpSessionId = runtimeHandle.acpSessionId;

    this.runtimeHandle.onProcessError((err) => {
      this.logger.error(err, `Child process error in session ${this.sessionId}`);
      void this.handleError(err).catch((e: unknown) => {
        this.logger.error(e, 'Failed to handle error');
      });
    });

    this.runtimeHandle.onProcessExit(() => {
      if (this.stopKind === 'error') return;

      void this.markSessionStopped('idle').catch((e: unknown) => {
        this.logger.error(e, 'Failed to update session status on exit');
      });
    });

    void this.runtimeHandle.closed
      .then(() => {
        if (this.stopKind === 'error') return;

        this.kill();
        void this.markSessionStopped('idle').catch((e: unknown) => {
          this.logger.error(e, 'Failed to update session status on close');
        });
      })
      .catch(async (error: unknown) => {
        this.logger.error(error, 'Connection closed with error');
        await this.handleError(error);
      });
  }

  async prompt(text: string, attachmentIds?: string[]): Promise<void> {
    try {
      this.currentMessage = '';
      this.currentThought = '';
      this.currentUserMessage = '';
      this.messageEventId = null;
      this.thoughtEventId = null;
      this.userMessageEventId = null;
      this.messageStartTime = null;
      this.thoughtStartTime = null;
      this.toolCallStartTime = null;
      this.textBuffer.reset();
      this.thoughtBuffer.reset();

      this.turnStartTime = Date.now();

      const sessionRecord = await this.db.query.sessions.findFirst({
        where: eq(sessions.id, this.sessionId),
      });

      if (sessionRecord?.title === 'new session') {
        const summary = text.trim();
        const firstLine = summary.split('\n')[0] || '';
        const titleVal = firstLine.length > 40 ? firstLine.slice(0, 40) + '...' : firstLine;
        await this.db
          .update(sessions)
          .set({ title: titleVal || 'new session' })
          .where(eq(sessions.id, this.sessionId));
      }

      if (this.stateMachine) {
        await this.stateMachine.transitionTo(this.sessionId, 'running');
      } else {
        await this.db
          .update(sessions)
          .set({ status: 'running', updatedAt: new Date() })
          .where(eq(sessions.id, this.sessionId));
      }

      interface AttachmentMeta {
        attachmentId: string;
        mimeType: string;
        filename: string;
        sizeBytes: number;
      }

      // Resolve attachments metadata & paths from disk
      const resolvedAttachmentsMeta: AttachmentMeta[] = [];
      const resolvedAttachmentFiles: { filePath: string; mimeType: string }[] = [];

      if (attachmentIds && attachmentIds.length > 0) {
        const sessionAttachmentsDir = path.join(os.tmpdir(), 'agentctl-attachments', this.sessionId);
        for (const id of attachmentIds) {
          const jsonPath = path.join(sessionAttachmentsDir, `${id}.json`);
          const binPath = path.join(sessionAttachmentsDir, `${id}.bin`);
          if (fs.existsSync(jsonPath) && fs.existsSync(binPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as AttachmentMeta;
              resolvedAttachmentsMeta.push(meta);
              resolvedAttachmentFiles.push({
                filePath: binPath,
                mimeType: meta.mimeType,
              });
            } catch (err) {
              this.logger.error(err, `Failed to read attachment metadata for ${id}`);
            }
          }
        }
      }

      // Persist user message immediately so it shows up in history
      const promptTokens = Math.ceil(text.length / 4);
      const userEventId = await this.eventStore.append(
        this.sessionId,
        'text',
        {
          content: text,
          role: 'user',
          attachments: resolvedAttachmentsMeta.length > 0 ? resolvedAttachmentsMeta : undefined,
        },
        null,
        { promptTokens }
      );
      this.currentParentEventId = userEventId;

      let promptText = text;
      if (!this.historyHydrated) {
        this.historyHydrated = true;

        const pastEvents = typeof this.db.select === 'function'
          ? await this.db
              .select()
              .from(acpEvents)
              .where(eq(acpEvents.sessionId, this.sessionId))
              .orderBy(asc(acpEvents.id))
          : [];

        const textEvents: { content: string; role?: string }[] = [];
        for (const e of pastEvents) {
          if (e.type === 'text') {
            try {
              const parsed = (typeof e.data === 'string' ? JSON.parse(e.data) : e.data) as Record<string, unknown> | null | undefined;
              if (parsed && typeof parsed.content === 'string') {
                textEvents.push({
                  content: parsed.content,
                  role: typeof parsed.role === 'string' ? parsed.role : undefined,
                });
              }
            } catch {
              // ignore
            }
          }
        }

        // We exclude the last one we just appended
        if (textEvents.length > 1) {
          const formattedHistory = textEvents
            .slice(0, -1)
            .map((item) => {
              const roleName = item.role === 'user' ? 'User' : 'Agent';
              return `### ${roleName}:\n${item.content}`;
            })
            .join('\n\n');

          promptText = `[System: The session runtime was restarted, so you have lost your active memory. Below is the transcript of the conversation history for your context. Please review the context and resume the task without repeating completed steps.]

## Conversation History:
${formattedHistory}

## User's New Prompt:
${text}`;
        }
      }

      await this.runtimeHandle.prompt(promptText, resolvedAttachmentFiles);

      await this.flushAll();

      if (this.stateMachine) {
        await this.stateMachine.transitionTo(this.sessionId, 'idle');
      } else {
        await this.db
          .update(sessions)
          .set({ status: 'idle', updatedAt: new Date() })
          .where(eq(sessions.id, this.sessionId));
      }
    } catch (error: unknown) {
      await this.flushAll();
      await this.handleError(error);
      throw error;
    }
  }

  private getBestOption(options?: { optionId: string; label?: string }[]): string | undefined {
    if (!options || options.length === 0) return undefined;

    const negativeKeywords = ['deny', 'cancel', 'reject', 'block', 'no'];
    const positiveOptions = options.filter((o) => {
      const id = o.optionId.toLowerCase();
      const label = (o.label ?? '').toLowerCase();
      return !negativeKeywords.some((neg) => id.includes(neg) || label.includes(neg));
    });

    if (positiveOptions.length === 0) {
      return options[0].optionId;
    }

    let best = positiveOptions.find((o) => {
      const id = o.optionId.toLowerCase();
      return id.includes('always') || id.includes('session') || id.includes('forever');
    });

    if (!best) {
      const positiveKeywords = ['allow', 'approve', 'yes', 'grant', 'confirm', 'ok'];
      best = positiveOptions.find((o) => {
        const id = o.optionId.toLowerCase();
        const label = (o.label ?? '').toLowerCase();
        return positiveKeywords.some((pos) => id.includes(pos) || label.includes(pos));
      });
    }

    best ??= positiveOptions[0];

    return best.optionId;
  }

  resolvePermission(permissionId: string, response: DomainPermissionResponse): void {
    const resolve = this.pendingApprovals.get(permissionId);
    if (resolve) {
      const request = this.pendingRequests.get(permissionId);
      this.pendingRequests.delete(permissionId);

      let finalResponse = response;
      if (
        response.allowed &&
        request
      ) {
        const reqOptions = request.options;
        if (reqOptions && reqOptions.length > 0) {
          const hasOption = reqOptions.some((o) => o.optionId === response.optionId);
          if (!hasOption) {
            const bestOptionId = this.getBestOption(reqOptions);
            finalResponse = {
              allowed: true,
              optionId: bestOptionId ?? reqOptions[0].optionId,
            };
          }
        } else {
          // If no options are provided by the agent, do not send any optionId
          finalResponse = {
            allowed: true,
          };
        }
      }

      resolve(finalResponse);
      this.pendingApprovals.delete(permissionId);

      const eventId = Number(permissionId);
      if (!isNaN(eventId)) {
        void this.eventStore.getEvent(eventId).then(async (event) => {
          if (event) {
            const currentData = event.data as Record<string, unknown>;
            const allowed = finalResponse.allowed;
            await this.eventStore.update(eventId, {
              ...currentData,
              status: allowed ? 'approved' : 'denied',
            });
          }
        });
      }
    }
  }

  kill(): void {
    if (this.isStopped) return;

    this.isStopped = true;
    this.pendingApprovals.clear();

    void this.flushAll().catch((err: unknown) => {
      this.logger.error(err, 'Failed to flush buffers in kill()');
    });

    void this.runtimeHandle.stop();
  }

  async stop(): Promise<void> {
    await this.flushAll();
    this.kill();
    await this.markSessionStopped('idle');
  }

  async updateModel(modelId: string): Promise<void> {
    if (this.isStopped) return;
    if (typeof this.runtimeHandle.updateModel === 'function') {
      await this.runtimeHandle.updateModel(modelId);
    }
  }

  async updateConfigOption(configId: string, value: string): Promise<void> {
    if (this.isStopped) return;
    if (typeof this.runtimeHandle.updateConfigOption === 'function') {
      await this.runtimeHandle.updateConfigOption(configId, value);
    }
  }

  private async handleError(error: unknown): Promise<void> {
    this.logger.error(error, `Error in ACPSession ${this.sessionId}`);
    this.stopKind = 'error';
    await this.flushAll();
    this.kill();
    await this.markSessionStopped('error');
  }

  private async markSessionStopped(status: 'idle' | 'error'): Promise<void> {
    this.stopKind = status;
    if (this.stateMachine) {
      await this.stateMachine.transitionTo(this.sessionId, status);
    } else {
      if (status === 'idle') {
        await this.db
          .update(sessions)
          .set({ status: 'idle', closedAt: new Date() })
          .where(eq(sessions.id, this.sessionId));
      } else {
        await this.db
          .update(sessions)
          .set({ status: 'error', updatedAt: new Date() })
          .where(eq(sessions.id, this.sessionId));
      }
    }
  }

  private currentMessage = '';
  private currentThought = '';
  private currentUserMessage = '';
  private messageEventId: number | null = null;
  private thoughtEventId: number | null = null;
  private userMessageEventId: number | null = null;
  private toolCallEventId: number | null = null;

  public async handleDomainEvent(event: DomainAgentEvent): Promise<void> {
    try {
      if (event.type === 'tool_call') {
        const { call, isUpdate } = event;
        if (!isUpdate) {
          // Flush buffers before starting tool calls!
          await this.flushAll();

          const parentId = this.thoughtEventId ?? this.currentParentEventId;

          // Reset buffers on new tool calls
          this.currentMessage = '';
          this.currentThought = '';
          this.currentUserMessage = '';
          this.messageEventId = null;
          this.thoughtEventId = null;
          this.userMessageEventId = null;
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
        return;
      }

      if (event.type === 'text') {
        this.currentMessage += event.text;
        const completionTokens = Math.ceil(this.currentMessage.length / 4);
        if (this.messageEventId) {
          this.textBuffer.append(event.text);
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
        return;
      }

      this.currentThought += event.text;
      const completionTokens = Math.ceil(this.currentThought.length / 4);
      if (this.thoughtEventId) {
        this.thoughtBuffer.append(event.text);
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
      return;
    } catch (error) {
      await this.handleError(error).catch((e: unknown) => {
        this.logger.error(e, 'Failed to handle error in handleDomainEvent');
      });
    }
  }

  public async handleRequestPermission(
    request: DomainPermissionRequest,
  ): Promise<DomainPermissionResponse> {
    try {
      const permissionId = request.toolCall.toolCallId ?? Math.random().toString(36).substring(7);

      const sessionRecord = await this.db.query.sessions.findFirst({
        where: eq(sessions.id, this.sessionId),
      });

      const toolName = request.toolCall.name;
      const shouldAutoApprove =
        sessionRecord?.approvalMode === 'yolo' ||
        (sessionRecord?.approvalMode === 'auto_approve' && toolName.startsWith('fs/'));

      if (shouldAutoApprove) {
        await this.eventStore.append(
          this.sessionId,
          'approval_request',
          {
            name: 'request_permission',
            toolCallId: permissionId,
            requiresApproval: true,
            request,
            status: 'approved',
          },
          this.currentParentEventId
        );

        const reqOptions = request.options;
        if (reqOptions && reqOptions.length > 0) {
          const bestOptionId = this.getBestOption(reqOptions);
          return {
            allowed: true,
            optionId: bestOptionId ?? reqOptions[0].optionId,
          };
        }

        return {
          allowed: true,
        };
      }

      if (this.stateMachine) {
        await this.stateMachine.transitionTo(this.sessionId, 'needs_attention');
      } else {
        await this.db
          .update(sessions)
          .set({ status: 'needs_attention', lastHeartbeat: new Date() })
          .where(eq(sessions.id, this.sessionId));
      }

      const eventId = await this.eventStore.append(
        this.sessionId,
        'approval_request',
        {
          name: 'request_permission',
          toolCallId: permissionId,
          requiresApproval: true,
          request,
          status: 'pending',
        },
        this.currentParentEventId
      );

      const approvalPromise = new Promise<DomainPermissionResponse>((resolve) => {
        this.pendingRequests.set(String(eventId), request);
        this.pendingApprovals.set(String(eventId), resolve);
      });

      return await Promise.race([
        approvalPromise,
        this.runtimeHandle.closed.then(() => {
          this.pendingRequests.delete(String(eventId));
          return {
            allowed: false,
          };
        }),
      ]);
    } catch (error) {
      await this.handleError(error);
      throw error;
    }
  }
}
