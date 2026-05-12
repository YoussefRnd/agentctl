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
  private pendingApprovals = new Map<number, (res: unknown) => void>();

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
      type: 'input',
      data: { text }
    });

    await this.db.update(sessions)
      .set({ status: 'running', updatedAt: new Date() })
      .where(eq(sessions.id, this.sessionId));
  }

  async approve(eventId: number) {
    this.client.send({
      type: 'approve',
      data: { eventId }
    });
    
    // Resume session status and bump updated_at
    await this.db.update(sessions)
      .set({ status: 'running', updatedAt: new Date() })
      .where(eq(sessions.id, this.sessionId));
  }

  async deny(eventId: number) {
    this.client.send({
      type: 'deny',
      data: { eventId }
    });
    
    // Resume session status and bump updated_at
    await this.db.update(sessions)
      .set({ status: 'running', updatedAt: new Date() })
      .where(eq(sessions.id, this.sessionId));
  }

  kill() {
    this.client.kill();
  }
}
