import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import type { 
  Client, 
  Agent, 
  RequestPermissionRequest, 
  SessionNotification, 
  RequestPermissionResponse,
  PromptRequest,
} from '@agentclientprotocol/sdk';
import { acpEvents, sessions } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { ACPEvent } from '@agentctl/shared';
import type { createDatabase } from '../db/index.js';
import type { ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

export interface IEventBus {
  publish(event: unknown): void;
}

export type DbClient = ReturnType<typeof createDatabase>;

export class ACPSession implements Client {
  private connection: ClientSideConnection;
  private agent!: Agent;
  private acpSessionId: string | null = null;
  private pendingApprovals = new Map<string, (response: RequestPermissionResponse) => void>();

  constructor(
    public sessionId: string,
    private child: ChildProcess,
    private db: DbClient,
    private eventBus: IEventBus,
    private cwd: string
  ) {
    this.child.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error(`Child process error in session ${this.sessionId}:`, err);
      void this.handleError(err);
    });

    const stdin = this.child.stdin;
    const stdout = this.child.stdout;
    if (stdin === null || stdout === null) {
      throw new Error('Child process missing stdin/stdout');
    }
    const stream = ndJsonStream(
      Writable.toWeb(stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(stdout) as ReadableStream<Uint8Array>
    );
    this.connection = new ClientSideConnection((agent) => {
      this.agent = agent;
      return this;
    }, stream);
  }

  async initialize(): Promise<void> {
    try {
      // Connect to the agent
      await this.connection.initialize({
        protocolVersion: 1,
        clientCapabilities: {
          terminal: true,
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
        },
        clientInfo: { name: 'agentctl', version: '1.0.0' },
      });

      const newSessionResult = await this.connection.newSession({
        cwd: this.cwd,
        mcpServers: [],
      });
      this.acpSessionId = newSessionResult.sessionId;

      // Update session record with agent info if needed
      await this.db.update(sessions)
        .set({ agentSessionId: this.acpSessionId, status: 'running' })
        .where(eq(sessions.id, this.sessionId));
        
      this.child.on('exit', () => {
        void this.db.update(sessions)
          .set({ status: 'idle', closedAt: new Date() })
          .where(eq(sessions.id, this.sessionId));
      });

      // Handle connection closure
      void this.connection.closed.then(() => {
        this.kill();
        void this.db.update(sessions)
          .set({ status: 'idle', closedAt: new Date() })
          .where(eq(sessions.id, this.sessionId));
      }).catch(async (error: unknown) => {
        // eslint-disable-next-line no-console
        console.error('Connection closed with error:', error);
        await this.handleError(error);
      });
    } catch (error) {
      await this.handleError(error);
      throw error;
    }
  }

  private async handleError(error: unknown): Promise<void> {
    // eslint-disable-next-line no-console
    console.error(`Error in ACPSession ${this.sessionId}:`, error);
    await this.db.update(sessions)
      .set({ status: 'error', updatedAt: new Date() })
      .where(eq(sessions.id, this.sessionId));
  }

  /**
   * Internal helper to persist an event and notify the event bus.
   */
  private async persistEvent(type: ACPEvent['type'], data: unknown): Promise<number | undefined> {
    const insertedArray = await this.db.insert(acpEvents).values({
      sessionId: this.sessionId,
      type,
      data: JSON.stringify(data),
    }).returning();

    if (insertedArray.length > 0) {
      this.eventBus.publish({
        ...insertedArray[0],
        createdAt: new Date(insertedArray[0].createdAt)
      });
      return insertedArray[0].id;
    }
    return undefined;
  }

  /**
   * Handles protocol-level notifications (e.g., status updates, messages, tool calls).
   * Can be called as a global handler or for a specific turn.
   */
  async handleNotification(notification: SessionNotification): Promise<void> {
    const update = notification.update;
    
    // Map SDK notification type to our internal ACPEvent['type']
    const typeMap: Record<string, ACPEvent['type']> = {
      'tool_call': 'tool_call',
      'agent_message_chunk': 'text',
      'diff': 'diff',
      'compact': 'compact',
      'approval_request': 'approval_request'
    };

    const typeKey = update.sessionUpdate;
    const eventType = typeMap[typeKey] ?? 'text';

    // Special logic for status updates (SessionInfoUpdate)
    if (typeKey === 'session_info_update') {
      // In the future we can map more info here
    }

    // Prepare data for UI (normalization)
    let uiData: unknown = update;
    if (typeKey === 'agent_message_chunk') {
      const chunk = update as Record<string, unknown>;
      const content = chunk.content as Record<string, unknown> | undefined;
      if (content?.type === 'text') {
        uiData = { content: content.text }; // Normalize for TextCard
      }
    }

    await this.persistEvent(eventType, uiData);
  }

  // Implementation of SDK Client interface
  async sessionUpdate(notification: SessionNotification): Promise<void> {
    try {
      await this.handleNotification(notification);
    } catch (error) {
      await this.handleError(error);
    }
  }

  // Implementation of SDK Client interface
  async requestPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    try {
      const permissionId = request.toolCall.toolCallId || Math.random().toString(36).substring(7);

      await this.db.update(sessions)
        .set({ status: 'needs_attention', lastHeartbeat: new Date() })
        .where(eq(sessions.id, this.sessionId));

      // Use a promise to wait for the DB insertion so we can capture the event ID
      return await new Promise<RequestPermissionResponse>((resolve) => {
        void (async () => {
          const eventId = await this.persistEvent('approval_request', { 
            name: 'request_permission', 
            toolCallId: permissionId,
            requiresApproval: true,
            request 
          });

          if (eventId !== undefined) {
            this.pendingApprovals.set(String(eventId), resolve);
          } else {
            // Fallback (should not happen with returning())
            this.pendingApprovals.set(permissionId, resolve);
          }
        })();
      });
    } catch (error) {
      await this.handleError(error);
      throw error;
    }
  }

  async prompt(text: string): Promise<void> {
    try {
      await this.db.update(sessions)
        .set({ status: 'running', updatedAt: new Date() })
        .where(eq(sessions.id, this.sessionId));

      const request: PromptRequest = {
        sessionId: this.acpSessionId ?? this.sessionId,
        prompt: [{ type: 'text', text }]
      };
      
      // prompt in v0.21.1 only takes one argument.
      // Out-of-turn notifications are handled via sessionUpdate interface method.
      await (this.connection.prompt(request) as Promise<unknown>);
    } catch (error: unknown) {
      await this.handleError(error);
      throw error;
    }
  }

  // Method to be called by external components (like API routes) to resolve pending permissions
  resolvePermission(permissionId: string, response: RequestPermissionResponse): void {
    const resolve = this.pendingApprovals.get(permissionId);
    if (resolve) {
      resolve(response);
      this.pendingApprovals.delete(permissionId);
    }
  }

  kill(): void {
    if (this.child.stdin && !this.child.stdin.destroyed) {
      this.child.stdin.end();
    }
    this.child.kill();
  }
}
