import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import type {
  RequestPermissionRequest,
  SessionNotification,
  RequestPermissionResponse,
  PromptRequest,
} from '@agentclientprotocol/sdk';
import { sessions, providers } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { createDatabase } from '../db/index.js';
import type { ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { type Logger, noopLogger } from '../logger.js';
import type { SessionEventStore } from './session-event-store.js';

export type DbClient = ReturnType<typeof createDatabase>;

export class ACPSession {
  private connection: ClientSideConnection;
  private acpSessionId: string | null = null;
  private pendingApprovals = new Map<string, (response: RequestPermissionResponse) => void>();
  private isStopped = false;
  private stopKind: 'idle' | 'error' | null = null;

  private static readonly STARTUP_TIMEOUT_MS = 60_000;

  constructor(
    public sessionId: string,
    private child: ChildProcess,
    private db: DbClient,
    private eventStore: SessionEventStore,
    private cwd: string,
    private logger: Logger = noopLogger,
  ) {
    this.child.on('error', (err) => {
      this.logger.error(err, `Child process error in session ${this.sessionId}`);
      void this.handleError(err).catch((e: unknown) => {
        this.logger.error(e, 'Failed to handle error');
      });
    });

    const stdin = this.child.stdin;
    const stdout = this.child.stdout;
    const stderr = this.child.stderr;

    if (stdin === null || stdout === null) {
      throw new Error('Child process missing stdin/stdout');
    }

    if (stderr) {
      stderr.on('data', (data: Buffer) => {
        this.logger.warn(`Agent stderr: ${data.toString()}`);
      });
    }

    const stream = ndJsonStream(
      Writable.toWeb(stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(stdout) as ReadableStream<Uint8Array>,
    );
    this.connection = new ClientSideConnection(
      () => ({
        sessionUpdate: (n) => this.onSessionUpdate(n),
        requestPermission: (r) => this.onRequestPermission(r),
      }),
      stream,
    );
  }

  async initialize(): Promise<void> {
    try {
      await this.withTimeout(
        this.connection.initialize({
          protocolVersion: 1,
          clientCapabilities: {
            terminal: true,
            fs: {
              readTextFile: true,
              writeTextFile: true,
            },
          },
          clientInfo: { name: 'agentctl', version: '1.0.0' },
        }),
        ACPSession.STARTUP_TIMEOUT_MS,
        'initializing ACP connection',
      );

      this.child.once('exit', () => {
        if (this.stopKind === 'error') return;

        void this.markSessionStopped('idle').catch((e: unknown) => {
          this.logger.error(e, 'Failed to update session status on exit');
        });
      });

      void this.connection.closed
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

      let newSessionResult;
      try {
        newSessionResult = await this.withTimeout(
          this.connection.newSession({
            cwd: this.cwd,
            mcpServers: [],
          }),
          ACPSession.STARTUP_TIMEOUT_MS,
          'creating ACP session',
        );
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && err.code === 'auth_required') {
          this.logger.warn(`Session ${this.sessionId} requires authentication`);
          await this.db
            .update(sessions)
            .set({ status: 'needs_attention' })
            .where(eq(sessions.id, this.sessionId));

          await this.eventStore.append(this.sessionId, 'status', {
            status: 'needs_auth',
            message: 'Authentication required. Please check your API keys or log in via CLI.',
          });
          return;
        }
        throw err;
      }
      this.acpSessionId = newSessionResult.sessionId;

      await this.db
        .update(sessions)
        .set({ agentSessionId: this.acpSessionId, status: 'running' })
        .where(eq(sessions.id, this.sessionId));

      interface DynamicConn {
        unstable_setSessionModel?: (p: { sessionId: string; modelId: string }) => Promise<unknown>;
        setSessionConfigOption?: (p: {
          sessionId: string;
          configId: string;
          value: string;
        }) => Promise<unknown>;
      }
      const dynConn = this.connection as unknown as DynamicConn;

      try {
        const session = (await this.db
          .select()
          .from(sessions)
          .where(eq(sessions.id, this.sessionId))).at(0);

        if (session) {
          const provider = (await this.db
            .select()
            .from(providers)
            .where(eq(providers.id, session.selectedProvider))).at(0);

          if (provider) {
            if (provider.supportsDynamicModel && session.selectedModel && session.selectedModel !== 'default') {
              this.logger.info(`Setting dynamic model: ${session.selectedModel} for session ${this.sessionId}`);
              if (typeof dynConn.unstable_setSessionModel === 'function') {
                await dynConn.unstable_setSessionModel({
                  sessionId: this.acpSessionId,
                  modelId: session.selectedModel,
                });
              } else {
                this.logger.warn(`Provider advertised supportsDynamicModel but connection.unstable_setSessionModel is not a function`);
              }
            }

            if (provider.supportsDynamicConfig && session.selectedThinkingEffort) {
              this.logger.info(`Setting dynamic config (thinking_effort): ${session.selectedThinkingEffort} for session ${this.sessionId}`);
              if (typeof dynConn.setSessionConfigOption === 'function') {
                await dynConn.setSessionConfigOption({
                  sessionId: this.acpSessionId,
                  configId: 'thinking_effort',
                  value: session.selectedThinkingEffort,
                });
              } else {
                this.logger.warn(`Provider advertised supportsDynamicConfig but connection.setSessionConfigOption is not a function`);
              }
            }
          }
        }
      } catch (err: unknown) {
        this.logger.error(err, `Failed to configure session dynamically for ${this.sessionId}`);
      }
    } catch (error) {
      await this.handleError(error);
      throw error;
    }
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

      await this.db
        .update(sessions)
        .set(updateFields)
        .where(eq(sessions.id, this.sessionId));

      const request: PromptRequest = {
        sessionId: this.acpSessionId ?? this.sessionId,
        prompt: [{ type: 'text', text }],
      };

      // Persist user message immediately so it shows up in history
      await this.eventStore.append(this.sessionId, 'text', { content: text, role: 'user' });

      await (this.connection.prompt(request) as Promise<unknown>);
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

    if (this.child.stdin && !this.child.stdin.destroyed) {
      this.child.stdin.end();
    }

    this.child.kill();
  }

  async stop(): Promise<void> {
    this.kill();
    await this.markSessionStopped('idle');
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

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Timed out while ${label}`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
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

  private async onSessionUpdate(notification: SessionNotification): Promise<void> {
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
        const chunk = update as { toolCall?: { name: string; arguments?: Record<string, unknown>; toolCallId?: string } };
        if (chunk.toolCall) {
          if (typeKey === 'tool_call') {
            // Reset buffers on new tool calls
            this.currentMessage = '';
            this.currentThought = '';
            this.currentUserMessage = '';
            this.messageEventId = null;
            this.thoughtEventId = null;
            this.userMessageEventId = null;

            this.toolCallEventId = await this.eventStore.append(this.sessionId, 'tool_call', chunk.toolCall);
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
            await this.eventStore.update(this.messageEventId, { content: this.currentMessage, role: 'provider' });
          } else {
            this.messageEventId = await this.eventStore.append(this.sessionId, 'text', { content: this.currentMessage, role: 'provider' });
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
            await this.eventStore.update(this.thoughtEventId, { content: this.currentThought, role: 'thought' });
          } else {
            this.thoughtEventId = await this.eventStore.append(this.sessionId, 'text', { content: this.currentThought, role: 'thought' });
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
            await this.eventStore.update(this.userMessageEventId, { content: this.currentUserMessage, role: 'user' });
          } else {
            this.userMessageEventId = await this.eventStore.append(this.sessionId, 'text', { content: this.currentUserMessage, role: 'user' });
          }
        }
        return;
      }

      const uiData = update;
      await this.eventStore.append(this.sessionId, eventType, uiData);
    } catch (error) {
      await this.handleError(error).catch((e: unknown) => {
        this.logger.error(e, 'Failed to handle error in onSessionUpdate');
      });
    }
  }

  private async onRequestPermission(
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
        this.connection.closed.then(() => ({
          outcome: { outcome: 'cancelled' as const },
        })),
      ]);
    } catch (error) {
      await this.handleError(error);
      throw error;
    }
  }
}

