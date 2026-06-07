import type {
  ClientSideConnection,
  RequestPermissionRequest,
  SessionNotification,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk';
import { sessions } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { createDatabase } from '../db/index.js';
import { type Logger, noopLogger } from '../logger.js';
import type { SessionEventStore } from './session-event-store.js';
import type { AgentRuntimeHandle } from './acp-transport.js';

export type DbClient = ReturnType<typeof createDatabase>;

export class ACPSession {
  private connection: ClientSideConnection;
  public acpSessionId: string | null = null;
  private pendingApprovals = new Map<string, (response: RequestPermissionResponse) => void>();
  private isStopped = false;
  private stopKind: 'idle' | 'error' | null = null;

  get isDead(): boolean {
    return this.isStopped;
  }

  constructor(
    public sessionId: string,
    private runtimeHandle: AgentRuntimeHandle,
    private db: DbClient,
    private eventStore: SessionEventStore,
    private cwd: string,
    private logger: Logger = noopLogger,
  ) {
    this.connection = runtimeHandle.connection;
    this.acpSessionId = runtimeHandle.acpSessionId;

    this.runtimeHandle.child.on('error', (err) => {
      this.logger.error(err, `Child process error in session ${this.sessionId}`);
      void this.handleError(err).catch((e: unknown) => {
        this.logger.error(e, 'Failed to handle error');
      });
    });

    this.runtimeHandle.child.once('exit', () => {
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

  async prompt(text: string): Promise<void> {
    try {
      this.currentMessage = '';
      this.currentThought = '';
      this.currentUserMessage = '';
      this.messageEventId = null;
      this.thoughtEventId = null;
      this.userMessageEventId = null;

      const sessionRecord = await this.db.query.sessions.findFirst({
        where: eq(sessions.id, this.sessionId),
      });

      const updateFields: Partial<typeof sessions.$inferInsert> = {
        status: 'running',
        updatedAt: new Date(),
      };

      if (sessionRecord?.title === 'new session') {
        const summary = text.trim();
        const firstLine = summary.split('\n')[0] || '';
        const titleVal = firstLine.length > 40 ? firstLine.slice(0, 40) + '...' : firstLine;
        updateFields.title = titleVal || 'new session';
      }

      await this.db.update(sessions).set(updateFields).where(eq(sessions.id, this.sessionId));

      // Persist user message immediately so it shows up in history
      await this.eventStore.append(this.sessionId, 'text', { content: text, role: 'user' });

      await this.runtimeHandle.prompt(text);

      await this.db
        .update(sessions)
        .set({ status: 'idle', updatedAt: new Date() })
        .where(eq(sessions.id, this.sessionId));
    } catch (error: unknown) {
      await this.handleError(error);
      throw error;
    }
  }

  resolvePermission(permissionId: string, response: RequestPermissionResponse): void {
    const resolve = this.pendingApprovals.get(permissionId);
    if (resolve) {
      resolve(response);
      this.pendingApprovals.delete(permissionId);
    }
  }

  kill(): void {
    if (this.isStopped) return;

    this.isStopped = true;
    this.pendingApprovals.clear();

    void this.runtimeHandle.stop();
  }

  async stop(): Promise<void> {
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
    this.kill();
    await this.markSessionStopped('error');
  }

  private async markSessionStopped(status: 'idle' | 'error'): Promise<void> {
    this.stopKind = status;

    if (status === 'idle') {
      await this.db
        .update(sessions)
        .set({ status: 'idle', closedAt: new Date() })
        .where(eq(sessions.id, this.sessionId));
      return;
    }

    await this.db
      .update(sessions)
      .set({ status: 'error', updatedAt: new Date() })
      .where(eq(sessions.id, this.sessionId));
  }

  private currentMessage = '';
  private currentThought = '';
  private currentUserMessage = '';
  private messageEventId: number | null = null;
  private thoughtEventId: number | null = null;
  private userMessageEventId: number | null = null;
  private toolCallEventId: number | null = null;

  public async handleNotification(notification: SessionNotification): Promise<void> {
    try {
      const update = notification.update;
      const typeKey = update.sessionUpdate;

      const typeMap: Record<string, 'tool_call' | 'text' | 'status' | undefined> = {
        tool_call: 'tool_call',
        tool_call_update: 'tool_call',
        agent_message_chunk: 'text',
        agent_thought_chunk: 'text',
        user_message_chunk: 'text',
        plan: 'status',
        available_commands_update: 'status',
        current_mode_update: 'status',
        config_option_update: 'status',
        session_info_update: 'status',
        usage_update: 'status',
      };

      const eventType = typeMap[typeKey];
      if (eventType === undefined) return;

      // Handle tool calls specifically to extract the toolCall object
      if (typeKey === 'tool_call' || typeKey === 'tool_call_update') {
        const chunk = update as {
          toolCall?: { name: string; arguments?: Record<string, unknown>; toolCallId?: string };
        };
        if (chunk.toolCall) {
          if (typeKey === 'tool_call') {
            // Reset buffers on new tool calls
            this.currentMessage = '';
            this.currentThought = '';
            this.currentUserMessage = '';
            this.messageEventId = null;
            this.thoughtEventId = null;
            this.userMessageEventId = null;

            this.toolCallEventId = await this.eventStore.append(
              this.sessionId,
              'tool_call',
              chunk.toolCall,
            );
          } else if (this.toolCallEventId) {
            await this.eventStore.update(this.toolCallEventId, chunk.toolCall);
          }
        }
        return;
      }

      // Handle message chunks with buffering
      if (typeKey === 'agent_message_chunk') {
        const chunk = update as { content?: { type: string; text?: string } };
        const text = chunk.content?.text;
        if (text !== undefined) {
          this.currentMessage += text;
          if (this.messageEventId) {
            await this.eventStore.update(this.messageEventId, {
              content: this.currentMessage,
              role: 'provider',
            });
          } else {
            this.messageEventId = await this.eventStore.append(this.sessionId, 'text', {
              content: this.currentMessage,
              role: 'provider',
            });
          }
        }
        return;
      }

      // Handle thought chunks with buffering
      if (typeKey === 'agent_thought_chunk') {
        const chunk = update as { content?: { type: string; thought?: string } };
        const thought = chunk.content?.thought;
        if (thought !== undefined) {
          this.currentThought += thought;
          if (this.thoughtEventId) {
            await this.eventStore.update(this.thoughtEventId, {
              content: this.currentThought,
              role: 'thought',
            });
          } else {
            this.thoughtEventId = await this.eventStore.append(this.sessionId, 'text', {
              content: this.currentThought,
              role: 'thought',
            });
          }
        }
        return;
      }

      // Reset buffers on major events that imply message end
      if (typeKey === 'plan') {
        this.currentMessage = '';
        this.currentThought = '';
        this.currentUserMessage = '';
        this.messageEventId = null;
        this.thoughtEventId = null;
        this.userMessageEventId = null;
      }

      // Handle user message chunks with buffering
      if (typeKey === 'user_message_chunk') {
        const chunk = update as { content?: { type: string; text?: string } };
        const text = chunk.content?.text;
        if (text !== undefined) {
          this.currentUserMessage += text;
          if (this.userMessageEventId) {
            await this.eventStore.update(this.userMessageEventId, {
              content: this.currentUserMessage,
              role: 'user',
            });
          } else {
            this.userMessageEventId = await this.eventStore.append(this.sessionId, 'text', {
              content: this.currentUserMessage,
              role: 'user',
            });
          }
        }
        return;
      }

      const uiData = update;
      await this.eventStore.append(this.sessionId, eventType, uiData);
    } catch (error) {
      await this.handleError(error).catch((e: unknown) => {
        this.logger.error(e, 'Failed to handle error in handleNotification');
      });
    }
  }

  public async handleRequestPermission(
    request: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    try {
      const permissionId = request.toolCall.toolCallId || Math.random().toString(36).substring(7);

      await this.db
        .update(sessions)
        .set({ status: 'needs_attention', lastHeartbeat: new Date() })
        .where(eq(sessions.id, this.sessionId));

      const eventId = await this.eventStore.append(this.sessionId, 'approval_request', {
        name: 'request_permission',
        toolCallId: permissionId,
        requiresApproval: true,
        request,
      });

      const approvalPromise = new Promise<RequestPermissionResponse>((resolve) => {
        this.pendingApprovals.set(String(eventId), resolve);
      });

      return await Promise.race([
        approvalPromise,
        this.runtimeHandle.closed.then(() => ({
          outcome: { outcome: 'cancelled' as const },
        })),
      ]);
    } catch (error) {
      await this.handleError(error);
      throw error;
    }
  }
}
