import type { ACPClient } from './acp-client.js';
import { acpEvents, sessions } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { ACPEvent, SessionStatus } from '@agentctl/shared';
import type { createDatabase } from '../db/index.js';

export interface IEventBus {
  publish(event: unknown): void;
}

export type DbClient = ReturnType<typeof createDatabase>;

export class SessionRunner {
  private pendingApprovals = new Map<number | string, { toolCallId: string; resolve: (result: unknown) => void }>();

  constructor(
    public sessionId: string,
    private client: ACPClient,
    private db: DbClient,
    private eventBus: IEventBus
  ) {
    this.setupListeners();
  }

  private setupListeners() {
    this.client.on('event', (event) => {
      void this.handleEvent(event);
    });

    this.client.on('rpcRequest', (request) => {
      void this.handleRpcRequest(request);
    });

    this.client.on('error', (error) => {
      // eslint-disable-next-line no-console
      console.error(`Session ${this.sessionId} error:`, error);
    });

    this.client.on('exit', () => {
      void this.db.update(sessions)
        .set({ status: 'idle', closedAt: new Date() })
        .where(eq(sessions.id, this.sessionId));
    });
  }

  private async handleRpcRequest(request: { id: number | string; method: string; params: unknown }) {
    if (request.method === 'session/request_permission') {
      const params = request.params as { id?: string; toolCallId?: string };
      const toolCallId = params.toolCallId ?? params.id ?? String(request.id);
      
      // Store the approval request with the JSON-RPC id
      void new Promise<unknown>((resolve) => {
        this.pendingApprovals.set(request.id, { toolCallId, resolve });
      });

      // Update session status to needs_attention
      await this.db.update(sessions)
        .set({ status: 'needs_attention', lastHeartbeat: new Date() })
        .where(eq(sessions.id, this.sessionId));

      // Emit event for UI to display
      const insertedArray = await this.db.insert(acpEvents).values({
        sessionId: this.sessionId,
        type: 'tool_call',
        data: JSON.stringify({ 
          name: 'request_permission', 
          toolCallId,
          requiresApproval: true,
          rpcId: request.id 
        }),
      }).returning();

      if (insertedArray.length > 0) {
        this.eventBus.publish({
          ...insertedArray[0],
          createdAt: new Date(insertedArray[0].createdAt)
        });
      }
    }
  }

  private async handleEvent(event: ACPEvent) {
    let newStatus: SessionStatus = 'running';
    const eventData = event.data as Record<string, unknown> | null;
    if (event.type === 'tool_call' && eventData?.requiresApproval) {
      newStatus = 'needs_attention';
    }

    await this.db.update(sessions)
      .set({ lastHeartbeat: new Date(), status: newStatus })
      .where(eq(sessions.id, this.sessionId));

    const insertedArray = await this.db.insert(acpEvents).values({
      sessionId: this.sessionId,
      type: event.type,
      data: JSON.stringify(event.data),
      createdAt: event.createdAt,
    }).returning();
    
    const inserted = insertedArray[0];

    if (insertedArray.length > 0) {
      this.eventBus.publish({
        ...inserted,
        createdAt: new Date(inserted.createdAt)
      });
    }
  }

  async input(text: string) {
    this.client.send({
      jsonrpc: '2.0',
      method: 'session/prompt',
      params: { prompt: [{ type: 'text', text }] }
    });

    await this.db.update(sessions)
      .set({ status: 'running', updatedAt: new Date() })
      .where(eq(sessions.id, this.sessionId));
  }

  async approve(eventId: number) {
    const pending = this.pendingApprovals.get(eventId);
    if (pending) {
      // Send proper JSON-RPC response for ACP
      this.client.sendResponse(eventId, {
        outcome: { outcome: 'selected', optionId: 'allow-always' }
      });
      this.pendingApprovals.delete(eventId);
    } else {
      // Fallback: try to find by toolCallId in pending
      for (const [id, pending] of this.pendingApprovals) {
        if (String(id) === String(eventId) || pending.toolCallId === String(eventId)) {
          this.client.sendResponse(id, {
            outcome: { outcome: 'selected', optionId: 'allow-always' }
          });
          this.pendingApprovals.delete(id);
          break;
        }
      }
    }
    
    await this.db.update(sessions)
      .set({ status: 'running', updatedAt: new Date() })
      .where(eq(sessions.id, this.sessionId));
  }

  async deny(eventId: number) {
    const pending = this.pendingApprovals.get(eventId);
    if (pending) {
      // Send proper JSON-RPC response for ACP
      this.client.sendResponse(eventId, {
        outcome: { outcome: 'selected', optionId: 'deny-once' }
      });
      this.pendingApprovals.delete(eventId);
    } else {
      // Fallback: try to find by toolCallId in pending
      for (const [id, pending] of this.pendingApprovals) {
        if (String(id) === String(eventId) || pending.toolCallId === String(eventId)) {
          this.client.sendResponse(id, {
            outcome: { outcome: 'selected', optionId: 'deny-once' }
          });
          this.pendingApprovals.delete(id);
          break;
        }
      }
    }
    
    await this.db.update(sessions)
      .set({ status: 'running', updatedAt: new Date() })
      .where(eq(sessions.id, this.sessionId));
  }

  kill() {
    this.client.kill();
  }
}
