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
import type { SessionStatus, ACPEvent } from '@agentctl/shared';
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
  private pendingApprovals = new Map<string, (response: RequestPermissionResponse) => void>();

  constructor(
    public sessionId: string,
    private child: ChildProcess,
    private db: DbClient,
    private eventBus: IEventBus
  ) {
    const stdin = this.child.stdin;
    const stdout = this.child.stdout;
    if (!stdin || !stdout) {
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
      const initResult = await this.connection.initialize({
        protocolVersion: 1,
        clientInfo: { name: 'agentctl', version: '1.0.0' },
      });

      // Update session record with agent info if needed
      await this.db.update(sessions)
        .set({ agentSessionId: initResult.agentInfo?.name ?? 'unknown', status: 'running' })
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

  async sessionUpdate(notification: SessionNotification): Promise<void> {
    try {
      const update = notification.update;
      let newStatus: SessionStatus = 'running';
      
      // Map SDK notification type to our internal ACPEvent['type']
      const typeMap: Record<string, ACPEvent['type']> = {
        'tool_call': 'tool_call',
        'agent_message_chunk': 'text',
        'diff': 'diff',
        'status': 'status',
        'compact': 'compact',
        'approval_request': 'approval_request'
      };

      // Extract details for status mapping
      if (update.sessionUpdate === 'session_info_update') {
        // Handle session info update if needed
      } else if (update.sessionUpdate === 'tool_call') {
        // If it's a tool call, it might need attention
        // Note: requestPermission usually handles this, but we can set it here too
      } else if ((update.sessionUpdate as string) === 'status') {
        // Special case for status updates
        const statusData = update as Record<string, unknown>;
        if (statusData.status === 'idle') {
          newStatus = 'idle';
        }
      }

      await this.db.update(sessions)
        .set({ lastHeartbeat: new Date(), status: newStatus })
        .where(eq(sessions.id, this.sessionId));

      const typeKey = update.sessionUpdate;
      const eventType = typeMap[typeKey] ?? 'text';

      const insertedArray = await this.db.insert(acpEvents).values({
        sessionId: this.sessionId,
        type: eventType,
        data: JSON.stringify(update),
      }).returning();

      if (insertedArray.length > 0) {
        this.eventBus.publish({
          ...insertedArray[0],
          createdAt: new Date(insertedArray[0].createdAt)
        });
      }
    } catch (error) {
      await this.handleError(error);
    }
  }

  async requestPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    try {
      const permissionId = request.toolCall.toolCallId || Math.random().toString(36).substring(7);

      // Update session status to needs_attention
      await this.db.update(sessions)
        .set({ status: 'needs_attention', lastHeartbeat: new Date() })
        .where(eq(sessions.id, this.sessionId));

      // Insert 'approval_request' event into DB
      const insertedArray = await this.db.insert(acpEvents).values({
        sessionId: this.sessionId,
        type: 'approval_request',
        data: JSON.stringify({ 
          name: 'request_permission', 
          toolCallId: permissionId,
          requiresApproval: true,
          request 
        }),
      }).returning();

      if (insertedArray.length > 0) {
        this.eventBus.publish({
          ...insertedArray[0],
          createdAt: new Date(insertedArray[0].createdAt)
        });
      }

      return await new Promise<RequestPermissionResponse>((resolve) => {
        const eventId = insertedArray[0]?.id;
        // eventId is always defined for auto-increment PK in this schema
        this.pendingApprovals.set(String(eventId), resolve);
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
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text }]
      };
      
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
